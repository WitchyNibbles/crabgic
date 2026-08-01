import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import { createFailingJournal, createRecordingJournal } from "../test-support/recording-journal.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import type { AuditReport } from "../quarantine/types.js";
import { createCapabilityStore } from "./store.js";
import {
  CAPABILITY_DECISION_TRANSITION_DECISION,
  CapabilityAuditJournalUnavailableError,
  parseCapabilityDecisionTransition,
} from "./audit-journal.js";
import { computeCapabilityStoreKey } from "./key.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("createCapabilityStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newRoot(): string {
    const dir = freshTmpDir();
    dirs.push(dir);
    return dir;
  }

  it("saves and loads back an audit report + manifest entry under the correct content-addressed key", () => {
    const root = newRoot();
    const store = createCapabilityStore(root);
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);

    const saved = store.save(report, manifestEntry);
    expect(saved.key).toBe(computeCapabilityStoreKey(report.digest, report.permissionFootprint));

    const loaded = store.load(saved.key);
    expect(loaded?.report).toEqual(report);
    expect(loaded?.manifestEntry).toEqual(manifestEntry);
  });

  it("returns undefined loading a key that was never saved", () => {
    const store = createCapabilityStore(newRoot());
    expect(store.load("nonexistent-key")).toBeUndefined();
  });

  it("updateDecision flips a stored entry's decision on both the report and the manifest entry", async () => {
    const store = createCapabilityStore(newRoot(), { journal: createRecordingJournal() });
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);

    const updated = await store.updateDecision(saved.key, "approved");
    expect(updated.report.decision).toBe("approved");
    expect(updated.manifestEntry).toMatchObject({ decision: "approved" });

    const reloaded = store.load(saved.key);
    expect(reloaded?.report.decision).toBe("approved");
    expect(reloaded?.manifestEntry).toMatchObject({ decision: "approved" });
  });

  it("updateDecision flips a report saved WITHOUT a manifest entry (a rejected audit produces none)", async () => {
    const store = createCapabilityStore(newRoot(), { journal: createRecordingJournal() });
    const { report } = runQuarantinePipeline({ kind: "skill" });
    const saved = store.save(report);

    const updated = await store.updateDecision(saved.key, "approved");
    expect(updated.report.decision).toBe("approved");
    expect(updated.manifestEntry).toBeUndefined();
  });

  it("updateDecision rejects for an unknown key", async () => {
    const store = createCapabilityStore(newRoot(), { journal: createRecordingJournal() });
    await expect(store.updateDecision("nonexistent-key", "approved")).rejects.toThrow(
      /no entry found/,
    );
  });

  it("list() returns every saved entry", () => {
    const store = createCapabilityStore(newRoot());
    const first = runQuarantinePipeline(BENIGN_SKILL);
    const second = runQuarantinePipeline({ ...BENIGN_SKILL, name: "another-skill" });
    store.save(first.report, first.manifestEntry);
    store.save(second.report, second.manifestEntry);
    expect(store.list()).toHaveLength(2);
  });

  it("findLatestByName resolves the latest entry saved for a given capability name", () => {
    const store = createCapabilityStore(newRoot());
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    const found = store.findLatestByName("benign-skill");
    expect(found?.report.digest).toBe(report.digest);
  });

  it("findLatestByName returns undefined for a name never saved", () => {
    const store = createCapabilityStore(newRoot());
    expect(store.findLatestByName("never-seen")).toBeUndefined();
  });

  it("findByDigest resolves the entry whose report.digest matches, ignoring by-name/approvals bookkeeping directories", () => {
    const store = createCapabilityStore(newRoot());
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    store.save(report, manifestEntry);
    expect(store.findByDigest(report.digest)?.report.digest).toBe(report.digest);
  });

  it("findByDigest returns undefined for a digest never saved", () => {
    const store = createCapabilityStore(newRoot());
    expect(store.findByDigest("sha256:never-saved")).toBeUndefined();
  });

  it("persists real files to disk under the given root (content-addressed, on-disk store — not merely in-memory)", () => {
    const root = newRoot();
    const store = createCapabilityStore(root);
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);

    // A brand-new store instance over the SAME root sees the same data.
    const reopened = createCapabilityStore(root);
    expect(reopened.load(saved.key)?.report.digest).toBe(report.digest);
  });

  /**
   * interface-ledger Gap 5, resolution (2026-08-01). `updateDecision`
   * OVERWRITES `report.json` in place — the artifact keeps only the newest
   * decision and no history at all, so before this the `pending ->
   * approved` flip (and `trust revoke`'s flip back) left no durable,
   * tamper-evident trace anywhere. The transition is now journaled FIRST,
   * as an `adjudication_decision`; only then is the artifact rewritten.
   */
  describe("decision-transition journaling (interface-ledger Gap 5)", () => {
    it("appends the pending -> approved transition BEFORE rewriting report.json", async () => {
      const root = newRoot();
      let savedKey = "";
      const onDiskAtAppendTime: string[] = [];
      const journal = createRecordingJournal(() => {
        const raw = readFileSync(join(root, savedKey, "report.json"), "utf8");
        onDiskAtAppendTime.push((JSON.parse(raw) as AuditReport).decision);
      });
      const store = createCapabilityStore(root, { journal });
      const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
      savedKey = store.save(report, manifestEntry).key;

      const updated = await store.updateDecision(savedKey, "approved");

      // The artifact still read `pending` at the instant the entry was appended.
      expect(onDiskAtAppendTime).toEqual(["pending"]);
      expect(updated.report.decision).toBe("approved");

      expect(journal.entries).toHaveLength(1);
      const [entry] = journal.entries;
      expect(entry?.type).toBe("adjudication_decision");
      expect(entry?.payload.decision).toBe(CAPABILITY_DECISION_TRANSITION_DECISION);
      const transition = parseCapabilityDecisionTransition(entry?.payload.rationale ?? "");
      expect(transition).toMatchObject({
        storeKey: savedKey,
        candidateName: "benign-skill",
        digest: report.digest,
        from: "pending",
        to: "approved",
      });
    });

    it("ABORTS the flip when the journal append fails — fail closed, artifact untouched", async () => {
      const root = newRoot();
      const store = createCapabilityStore(root, { journal: createFailingJournal() });
      const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
      const saved = store.save(report, manifestEntry);

      await expect(store.updateDecision(saved.key, "approved")).rejects.toThrow(
        /journal append failed/,
      );
      expect(store.load(saved.key)?.report.decision).toBe("pending");
      expect(store.load(saved.key)?.manifestEntry).toMatchObject({ decision: "pending" });
    });

    it("fails CLOSED when the store was constructed without a journal sink", async () => {
      const store = createCapabilityStore(newRoot());
      const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
      const saved = store.save(report, manifestEntry);

      await expect(store.updateDecision(saved.key, "approved")).rejects.toBeInstanceOf(
        CapabilityAuditJournalUnavailableError,
      );
      expect(store.load(saved.key)?.report.decision).toBe("pending");
    });

    it("journals a revoke (approved -> rejected) too, so the reversal is as durable as the approval", async () => {
      const journal = createRecordingJournal();
      const store = createCapabilityStore(newRoot(), { journal });
      const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
      const saved = store.save(report, manifestEntry);

      await store.updateDecision(saved.key, "approved");
      await store.updateDecision(saved.key, "rejected");

      expect(
        journal.entries.map((e) => parseCapabilityDecisionTransition(e.payload.rationale)),
      ).toMatchObject([
        { from: "pending", to: "approved" },
        { from: "approved", to: "rejected" },
      ]);
    });
  });
});

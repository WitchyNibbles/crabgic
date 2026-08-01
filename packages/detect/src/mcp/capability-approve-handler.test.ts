import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalTokenMinter } from "@crabgic/contracts";
import { freshTmpDir, removeDirTree } from "../test-support/fixture-repo.js";
import {
  createFailingJournal,
  createRecordingJournal,
  type RecordingJournal,
} from "../test-support/recording-journal.js";
import { createCapabilityStore } from "../capability-store/store.js";
import { parseCapabilityDecisionTransition } from "../capability-store/audit-journal.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import { runCapabilityApprove } from "./capability-approve-handler.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("runCapabilityApprove", () => {
  const dirs: string[] = [];
  let journal: RecordingJournal;
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });
  function newStore() {
    const dir = freshTmpDir();
    dirs.push(dir);
    journal = createRecordingJournal();
    return createCapabilityStore(dir, { journal });
  }

  it("approves and flips the stored decision when verifying a genuinely pre-minted trust-approve token", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", report.digest);

    const result = await runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );

    expect(result).toEqual({ approved: true });
    expect(store.load(saved.key)?.report.decision).toBe("approved");

    // interface-ledger Gap 5, resolution: the flip itself is now durable.
    expect(journal.entries).toHaveLength(1);
    expect(
      parseCapabilityDecisionTransition(journal.entries[0]?.payload.rationale ?? ""),
    ).toMatchObject({ storeKey: saved.key, from: "pending", to: "approved" });
  });

  /**
   * interface-ledger Gap 5, resolution (2026-08-01). The token is consumed
   * by `verify` either way — that is the minter's single-use contract —
   * but the capability must NOT end up approved when the transition
   * cannot be recorded. A consumed token with no approval is recoverable
   * (mint another); an approval with no record is not.
   */
  it("does NOT approve when the decision transition cannot be journaled — fail closed", async () => {
    const dir = freshTmpDir();
    dirs.push(dir);
    const store = createCapabilityStore(dir, { journal: createFailingJournal() });
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", report.digest);

    await expect(
      runCapabilityApprove(
        { digest: report.digest, token: minted.token },
        { minter, store, storeKey: saved.key },
      ),
    ).rejects.toThrow(/journal append failed/);
    expect(store.load(saved.key)?.report.decision).toBe("pending");
  });

  it("fails closed (never approves) for a model-self-approval attempt with NO pre-minted token (roadmap/12's own named seeded threat)", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });

    const result = await runCapabilityApprove(
      { digest: report.digest, token: "totally-fabricated-token-nobody-minted" },
      { minter, store, storeKey: saved.key },
    );

    expect(result.approved).toBe(false);
    expect(store.load(saved.key)?.report.decision).toBe("pending");
    // No verify, no transition — a refused approval journals nothing.
    expect(journal.entries).toHaveLength(0);
  });

  it("fails closed for a token minted against a DIFFERENT digest (mismatch never verifies)", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", "sha256:some-other-digest-entirely");

    const result = await runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(result.approved).toBe(false);
  });

  it("fails closed replaying an already-consumed token (single-use)", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("capability_digest", report.digest);

    const first = await runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(first.approved).toBe(true);

    const replay = await runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(replay.approved).toBe(false);
  });

  it("fails closed for a token minted under subjectKind envelope_hash (11's subject), never satisfying capability_digest", async () => {
    const store = newStore();
    const { report, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);
    const saved = store.save(report, manifestEntry);
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const minted = await minter.mint("envelope_hash", report.digest);

    const result = await runCapabilityApprove(
      { digest: report.digest, token: minted.token },
      { minter, store, storeKey: saved.key },
    );
    expect(result.approved).toBe(false);
  });
});

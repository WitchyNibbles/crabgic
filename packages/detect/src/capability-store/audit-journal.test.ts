/**
 * interface-ledger Gap 5, resolution (2026-08-01).
 *
 * The write path is exercised by `./store.test.ts` and `../mcp/
 * capability-audit-handler.test.ts` against a recording fake. This suite
 * covers the two things a fake cannot prove:
 *
 * 1. **A REAL `JournalStore` genuinely satisfies `CapabilityAuditJournalSink`.**
 *    The sink is a hand-written structural subset of `appendEntry`; if the
 *    real store's `JournalEntryInput` ever stopped accepting the shape this
 *    module writes — or if `AdjudicationDecisionPayloadSchema`'s `.strict()`
 *    rejected it — every fake-backed test would still pass while production
 *    threw at runtime. So these round-trip through a real on-disk,
 *    hash-chained journal.
 * 2. **The read side is guarded.** A journal is shared: it holds other
 *    phases' `adjudication_decision` entries (14's coverage ratchet, 14's
 *    flake registry, 04's own chain-repair report) and, in a tampered or
 *    partially-written file, arbitrary text. Reading must never throw and
 *    must never mistake a foreign record for a capability verdict.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { removeDirTree } from "../test-support/fixture-repo.js";
import { runQuarantinePipeline } from "../quarantine/pipeline.js";
import type { AuditReport } from "../quarantine/types.js";
import {
  CAPABILITY_AUDIT_DECISION_PREFIX,
  CAPABILITY_AUDIT_VERDICT_DECISION,
  CAPABILITY_DECISION_TRANSITION_DECISION,
  CapabilityAuditJournalUnavailableError,
  buildCapabilityAuditVerdictRecord,
  journalCapabilityAuditVerdict,
  journalCapabilityDecisionTransition,
  parseCapabilityAuditVerdict,
  parseCapabilityDecisionTransition,
  readCapabilityAuditVerdicts,
  readCapabilityDecisionTransitions,
} from "./audit-journal.js";
import { computeCapabilityStoreKey } from "./key.js";
import { createCapabilityStore } from "./store.js";

const BENIGN_SKILL = {
  kind: "skill",
  name: "benign-skill",
  files: [{ path: "SKILL.md", content: "# ordinary\n" }],
  permissionFootprint: ["Read(./**)"],
};

/** Reaches stage 4 and fails there with real `critical` findings (a private-key block). */
const LEAKY_SKILL = {
  kind: "skill",
  name: "leaky-skill",
  files: [{ path: "SKILL.md", content: "-----BEGIN OPENSSH PRIVATE KEY-----\n" }],
  permissionFootprint: ["Read(./**)"],
};

describe("capability-audit journaling (interface-ledger Gap 5)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });

  function newJournal(): JournalStore {
    const dir = mkdtempSync(join(tmpdir(), "eo-detect-journal-"));
    dirs.push(dir);
    return createJournalStore({ journalDir: dir });
  }

  function report(candidate: unknown): AuditReport {
    return runQuarantinePipeline(candidate).report;
  }

  describe("the sink is satisfied by a real JournalStore", () => {
    it("round-trips a verdict through a real hash-chained journal and back out of the reader", async () => {
      const journal = newJournal();
      const built = buildCapabilityAuditVerdictRecord(report(LEAKY_SKILL), {
        requiresReaudit: true,
        reason: "no prior audit found for this capability name",
      });

      await journalCapabilityAuditVerdict(journal, built);

      // The REAL store accepted it: the payload passed
      // `AdjudicationDecisionPayloadSchema`'s `.strict()` check and the
      // entry is chain-verifiable, not merely written.
      const verification = await journal.verifyJournal();
      expect(verification.valid).toBe(true);
      expect(verification.totalValidEntries).toBe(1);

      const verdicts = await readCapabilityAuditVerdicts(journal);
      expect(verdicts).toEqual([built]);
    });

    it("round-trips a decision transition through a real journal", async () => {
      const journal = newJournal();
      const record = {
        storeKey: "k".repeat(64),
        candidateName: "benign-skill",
        digest: "sha256:abc",
        from: "pending",
        to: "approved",
        recordedAt: "2026-08-01T00:00:00.000Z",
      } as const;

      await journalCapabilityDecisionTransition(journal, record);

      expect(await readCapabilityDecisionTransitions(journal)).toEqual([record]);
    });

    it("both discriminators live under the capability_audit: prefix and never collide", () => {
      expect(CAPABILITY_AUDIT_VERDICT_DECISION.startsWith(CAPABILITY_AUDIT_DECISION_PREFIX)).toBe(
        true,
      );
      expect(
        CAPABILITY_DECISION_TRANSITION_DECISION.startsWith(CAPABILITY_AUDIT_DECISION_PREFIX),
      ).toBe(true);
      expect(CAPABILITY_AUDIT_VERDICT_DECISION).not.toBe(CAPABILITY_DECISION_TRANSITION_DECISION);
    });
  });

  describe("the record", () => {
    it("derives the storeKey the store itself will use, so it can be journaled BEFORE save", () => {
      const root = mkdtempSync(join(tmpdir(), "eo-detect-store-"));
      dirs.push(root);
      const store = createCapabilityStore(root);
      const { report: rpt, manifestEntry } = runQuarantinePipeline(BENIGN_SKILL);

      expect(buildCapabilityAuditVerdictRecord(rpt).storeKey).toBe(
        store.save(rpt, manifestEntry).key,
      );
    });

    it("summarises findings as a count plus DISTINCT severities ordered least-to-most severe", () => {
      const built = buildCapabilityAuditVerdictRecord({
        ...report(BENIGN_SKILL),
        scanFindings: [
          { scanner: "a", severity: "critical", detail: "x" },
          { scanner: "b", severity: "low", detail: "y" },
          { scanner: "c", severity: "critical", detail: "z" },
          { scanner: "d", severity: "medium", detail: "w" },
        ],
      });

      expect(built.scanFindingCount).toBe(4);
      expect(built.scanFindingSeverities).toEqual(["low", "medium", "critical"]);
    });

    it("carries no scan-finding DETAIL — a scanner detail line can quote the secret it matched", async () => {
      const journal = newJournal();
      await journalCapabilityAuditVerdict(
        journal,
        buildCapabilityAuditVerdictRecord(report(LEAKY_SKILL)),
      );

      const [entry] = await readCapabilityAuditVerdicts(journal);
      expect(JSON.stringify(entry)).not.toContain("PRIVATE KEY");
    });

    it("omits the re-audit fields entirely when no ReauditDecision was computed", () => {
      const built = buildCapabilityAuditVerdictRecord(report(BENIGN_SKILL));
      expect(built.reauditRequired).toBeUndefined();
      expect(built.reauditReason).toBeUndefined();
    });

    it("records reachedManifestEntry true only for a candidate that cleared all six stages", () => {
      expect(buildCapabilityAuditVerdictRecord(report(BENIGN_SKILL)).reachedManifestEntry).toBe(
        true,
      );
      expect(buildCapabilityAuditVerdictRecord(report(LEAKY_SKILL)).reachedManifestEntry).toBe(
        false,
      );
    });

    it("is deterministic — two audits of a byte-identical candidate journal identical records but for the clock", () => {
      const clock = () => "2026-08-01T00:00:00.000Z";
      const first = runQuarantinePipeline(BENIGN_SKILL, { clock }).report;
      const second = runQuarantinePipeline(BENIGN_SKILL, { clock }).report;
      expect(buildCapabilityAuditVerdictRecord(first)).toEqual(
        buildCapabilityAuditVerdictRecord(second),
      );
    });
  });

  describe("the reader never trusts journal content", () => {
    it("returns undefined for a rationale that is not JSON at all", () => {
      expect(parseCapabilityAuditVerdict("not json {{{")).toBeUndefined();
      expect(parseCapabilityDecisionTransition("not json {{{")).toBeUndefined();
    });

    it("returns undefined for valid JSON of the wrong shape, and for the OTHER record kind", () => {
      expect(parseCapabilityAuditVerdict('{"unexpected":true}')).toBeUndefined();
      expect(parseCapabilityAuditVerdict("[]")).toBeUndefined();
      expect(parseCapabilityAuditVerdict("null")).toBeUndefined();
      // A transition record is not a verdict record, and vice versa.
      const transition = JSON.stringify({
        storeKey: "k",
        candidateName: "n",
        digest: "d",
        from: "pending",
        to: "approved",
        recordedAt: "t",
      });
      expect(parseCapabilityAuditVerdict(transition)).toBeUndefined();
      expect(parseCapabilityDecisionTransition('{"unexpected":true}')).toBeUndefined();
    });

    it("skips foreign adjudication_decision entries and undecodable capability entries alike", async () => {
      const journal = newJournal();

      // 14's coverage ratchet — same member, different discriminator.
      await journal.appendEntry({
        type: "adjudication_decision",
        payload: {
          decision: "coverage_ratchet_observation",
          rationale: JSON.stringify({
            projectId: "p",
            linePct: 90,
            branchPct: 80,
            observedAt: "t",
          }),
        },
      });
      // A capability entry whose rationale is garbage (a partially-written
      // or tampered record) — skipped, never thrown on.
      await journal.appendEntry({
        type: "adjudication_decision",
        payload: { decision: CAPABILITY_AUDIT_VERDICT_DECISION, rationale: "{not-json" },
      });
      await journal.appendEntry({
        type: "adjudication_decision",
        payload: { decision: CAPABILITY_DECISION_TRANSITION_DECISION, rationale: "{not-json" },
      });
      // A wholly different member, which the type filter must exclude.
      await journal.appendEntry({
        type: "fanout_rationale",
        payload: { rationale: "not an adjudication at all" },
      });

      const good = buildCapabilityAuditVerdictRecord(report(BENIGN_SKILL));
      await journalCapabilityAuditVerdict(journal, good);

      expect(await readCapabilityAuditVerdicts(journal)).toEqual([good]);
      expect(await readCapabilityDecisionTransitions(journal)).toEqual([]);
    });

    it("narrows verdicts by candidate name and transitions by store key", async () => {
      const journal = newJournal();
      const benign = buildCapabilityAuditVerdictRecord(report(BENIGN_SKILL));
      const leaky = buildCapabilityAuditVerdictRecord(report(LEAKY_SKILL));
      await journalCapabilityAuditVerdict(journal, benign);
      await journalCapabilityAuditVerdict(journal, leaky);

      expect(await readCapabilityAuditVerdicts(journal, "leaky-skill")).toEqual([leaky]);
      expect(await readCapabilityAuditVerdicts(journal, "never-audited")).toEqual([]);

      const base = {
        candidateName: "benign-skill",
        digest: "sha256:abc",
        recordedAt: "2026-08-01T00:00:00.000Z",
      };
      await journalCapabilityDecisionTransition(journal, {
        ...base,
        storeKey: "a".repeat(64),
        from: "pending",
        to: "approved",
      });
      await journalCapabilityDecisionTransition(journal, {
        ...base,
        storeKey: "b".repeat(64),
        from: "pending",
        to: "rejected",
      });

      expect(await readCapabilityDecisionTransitions(journal, "b".repeat(64))).toMatchObject([
        { to: "rejected" },
      ]);
    });

    /**
     * A real `JournalStore` decodes payloads through
     * `AdjudicationDecisionPayloadSchema`, so it can only ever hand back
     * an object with string `decision`/`rationale`, and it honours the
     * `type` filter. These guards exist for the readers that are NOT that
     * — a caller passing a narrower/looser implementation of
     * `CapabilityAuditJournalReader`, or a decode path that ever starts
     * yielding raw content. They must skip, never throw.
     */
    it("skips entries a non-JournalStore reader yields with a malformed or non-object payload", async () => {
      const good = buildCapabilityAuditVerdictRecord(report(BENIGN_SKILL));
      const looseReader = {
        async *queryEntries() {
          yield { type: "adjudication_decision" as const, payload: null };
          yield { type: "adjudication_decision" as const, payload: "a bare string" };
          yield { type: "adjudication_decision" as const, payload: 42 };
          yield { type: "adjudication_decision" as const, payload: { decision: 7, rationale: 9 } };
          yield {
            type: "adjudication_decision" as const,
            payload: { decision: CAPABILITY_AUDIT_VERDICT_DECISION, rationale: 12345 },
          };
          // The filter ignored: a foreign member reaches the loop body.
          yield { type: "fanout_rationale" as const, payload: { rationale: "foreign" } };
          yield {
            type: "adjudication_decision" as const,
            payload: {
              decision: CAPABILITY_AUDIT_VERDICT_DECISION,
              rationale: JSON.stringify(good),
            },
          };
        },
      };

      expect(await readCapabilityAuditVerdicts(looseReader)).toEqual([good]);
      expect(await readCapabilityDecisionTransitions(looseReader)).toEqual([]);
    });

    it("preserves append order across many verdicts (the audit trail is a sequence, not a set)", async () => {
      const journal = newJournal();
      const names = ["one", "two", "three"];
      for (const name of names) {
        await journalCapabilityAuditVerdict(
          journal,
          buildCapabilityAuditVerdictRecord(report({ ...BENIGN_SKILL, name })),
        );
      }
      expect((await readCapabilityAuditVerdicts(journal)).map((v) => v.candidateName)).toEqual(
        names,
      );
    });
  });

  it("the fail-closed error names the refusing operation and cites the ruling", () => {
    const err = new CapabilityAuditJournalUnavailableError("capability.audit");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityAuditJournalUnavailableError");
    expect(err.message).toContain("capability.audit");
    expect(err.message).toContain("Gap 5");
  });

  it("a rejected verdict's storeKey still resolves — a rejection is a real, addressable store entry", () => {
    const rejected = report({ kind: "skill" });
    expect(buildCapabilityAuditVerdictRecord(rejected).storeKey).toBe(
      computeCapabilityStoreKey(rejected.digest, rejected.permissionFootprint),
    );
  });
});

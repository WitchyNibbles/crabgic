import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, recordAttempt, type JournalStore } from "@crabgic/journal";
import {
  assertRepairAllowed,
  countPriorDispatches,
  MAX_TOTAL_DISPATCHES,
  needsRepairPolicyCheck,
} from "./attempt-policy.js";
import { RepairEvidenceRequiredError } from "./errors.js";

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_A = "22222222-2222-4222-8222-222222222222";
const SESSION_B = "33333333-3333-4333-8333-333333333333";
const SESSION_C = "44444444-4444-4444-8444-444444444444";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-attempt-policy-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("countPriorDispatches", () => {
  it("is 0 before any attempt has been recorded", async () => {
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(0);
  });

  it("counts only 'dispatched' transitions, not 'failed'/'succeeded'/'parked:rate_limit' themselves", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(2);
  });

  it("MAJOR-1 fix: EXCLUDES a 'dispatched' transition whose previousStatus is 'parked:rate_limit' — a rate-limit-park resume is NOT a repair and must never consume repair budget", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched"); // real dispatch #1 (previousStatus undefined)
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "parked:rate_limit"); // external throttle, not a failure
    // The park-resume's own 'dispatched' entry — previousStatus is
    // 'parked:rate_limit' — must NOT count toward the repair cap.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(1);

    // Park again, resume again — still only 1 REAL dispatch counted, no
    // matter how many park/resume cycles occur.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "parked:rate_limit");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(1);

    // A GENUINE failure-driven repair afterward DOES count.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched"); // previousStatus 'failed' — a real repair
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(2);
  });

  /**
   * Run-scoping (2026-07-30). Work-unit ids are stable across runs of the
   * same change set, so a workUnitId-only count made a RETRY as a genuinely
   * new run inherit the prior run's exhausted repair budget and be refused.
   * The budget's purpose is to stop a REPAIR LOOP within a run; a fresh run
   * (a new, containment-gated, journaled dispatch) is a fresh attempt
   * sequence and gets its own budget. With a runId, the count sees only that
   * run's dispatches; without one it is unchanged (counts across all runs).
   */
  it("scopes the count to a runId when given, so a retry run does not inherit the prior run's budget", async () => {
    const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched", RUN_A);

    // Run A saw two dispatches; run B has seen none.
    expect(await countPriorDispatches(store, WORK_UNIT_ID, RUN_A)).toBe(2);
    expect(await countPriorDispatches(store, WORK_UNIT_ID, RUN_B)).toBe(0);
    // Unscoped (no runId) still counts across all runs — unchanged default.
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(2);
  });

  /**
   * The `previousStatus` off-by-one a prior review found: run A leaves the
   * unit's latest transition at `parked:rate_limit`, then run B (a retry)
   * dispatches it. Because `recordAttempt` now derives `previousStatus`
   * run-scoped, run B's FIRST dispatch has NO prior status in run B — so it
   * is NOT mistaken for a park-resume and correctly counts toward run B's
   * own budget. Cross-run, an unscoped derivation had inherited run A's
   * `parked` status and wrongly excluded the dispatch, inflating the cap.
   */
  it("does not let a prior run's park leak into a retry run's repair count", async () => {
    const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    // Run A: dispatched, then rate-limit parked (and never resumed).
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "parked:rate_limit", RUN_A);

    // Run B's first dispatch of the same unit.
    const runBFirst = await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched", RUN_B);
    // Run-scoped derivation: no prior attempt IN RUN B → no previousStatus,
    // so it is not excluded as a park-resume.
    expect(runBFirst.previousStatus).toBeUndefined();
    expect(await countPriorDispatches(store, WORK_UNIT_ID, RUN_B)).toBe(1);
  });
});

describe("assertRepairAllowed", () => {
  it("allows the very first dispatch with no evidence at all", async () => {
    await expect(assertRepairAllowed(store, WORK_UNIT_ID, "none")).resolves.toBeUndefined();
  });

  it("refuses a repair (2nd dispatch) with reason 'noNewEvidence' when evidenceKind is 'none'", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");

    await expect(assertRepairAllowed(store, WORK_UNIT_ID, "none")).rejects.toThrow(
      RepairEvidenceRequiredError,
    );
    try {
      await assertRepairAllowed(store, WORK_UNIT_ID, "none");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RepairEvidenceRequiredError);
      expect((err as RepairEvidenceRequiredError).reason).toBe("noNewEvidence");
      expect((err as RepairEvidenceRequiredError).priorDispatchCount).toBe(1);
    }
  });

  it("allows a repair (2nd dispatch) when evidenceKind is 'workerResultFailure'", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure"),
    ).resolves.toBeUndefined();
  });

  it("scoped to a runId, a NEW run's first dispatch is allowed even though a PRIOR run exhausted the budget", async () => {
    const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    // Run A burns all three dispatches on this unit.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "failed", RUN_A);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_C, "dispatched", RUN_A);

    // Unscoped, this unit is exhausted (3 dispatches) — the pre-fix behavior
    // a retry run inherited.
    await expect(assertRepairAllowed(store, WORK_UNIT_ID, "none")).rejects.toThrow(
      RepairEvidenceRequiredError,
    );
    // Scoped to a fresh run, its FIRST dispatch is allowed with no evidence.
    await expect(assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, RUN_B)).resolves.toBe(
      undefined,
    );
  });

  it("allows a repair when evidenceKind is 'schemaViolation', 'crash', or 'gateVerdict'", async () => {
    const workUnitIds = [
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ];
    const evidenceKinds = ["schemaViolation", "crash", "gateVerdict"] as const;
    for (let i = 0; i < evidenceKinds.length; i++) {
      const workUnitId = workUnitIds[i]!;
      await recordAttempt(store, workUnitId, SESSION_A, "dispatched");
      await recordAttempt(store, workUnitId, SESSION_A, "failed");
      await expect(
        assertRepairAllowed(store, workUnitId, evidenceKinds[i]!),
      ).resolves.toBeUndefined();
    }
  });

  it("allows the 3rd (final) dispatch with evidence after 2 prior dispatches", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "failed");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(2);
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure"),
    ).resolves.toBeUndefined();
  });

  it("refuses a 4th dispatch with reason 'attemptsExhausted' even WITH fresh evidence — the cap is absolute", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "failed");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_C, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_C, "failed");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(MAX_TOTAL_DISPATCHES);

    await expect(assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure")).rejects.toThrow(
      RepairEvidenceRequiredError,
    );
    try {
      await assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure");
      expect.unreachable();
    } catch (err) {
      expect((err as RepairEvidenceRequiredError).reason).toBe("attemptsExhausted");
    }
  });

  it("re-checking evidence multiple times before an actual redispatch never itself consumes a repair slot (no double-counting)", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");

    // Citing the SAME schema-violation evidence three times in a row (e.g.
    // a caller re-validating before actually redispatching) must not
    // advance the journal-derived counter — only a real `dispatched` entry
    // does that.
    await assertRepairAllowed(store, WORK_UNIT_ID, "schemaViolation");
    await assertRepairAllowed(store, WORK_UNIT_ID, "schemaViolation");
    await assertRepairAllowed(store, WORK_UNIT_ID, "schemaViolation");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(1);
  });

  it("MAJOR-1 fix: a park→resume cycle does NOT decrement the available repair budget — the 3-dispatch cap is still reachable afterward", async () => {
    // Real dispatch #1.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    // Parked (external throttle) and resumed twice — neither cycle is a
    // repair, so neither should consume budget.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "parked:rate_limit");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched"); // park-resume #1
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "parked:rate_limit");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched"); // park-resume #2
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(1);

    // A genuine failure now — repair #1 (2nd REAL dispatch) is allowed.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure"),
    ).resolves.toBeUndefined();
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(2);

    // Repair #2 (3rd REAL dispatch, the cap) is STILL available — the two
    // park/resume cycles earlier never ate into this budget.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure"),
    ).resolves.toBeUndefined();
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    expect(await countPriorDispatches(store, WORK_UNIT_ID)).toBe(3);

    // NOW the cap is truly exhausted (3 real dispatches).
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure")).rejects.toThrow(
      RepairEvidenceRequiredError,
    );
  });

  describe("evidence-distinctness (evidenceDetail)", () => {
    it("omitting evidenceDetail entirely skips the distinctness check (backward-compatible)", async () => {
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
      await assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "failed");
      // Citing the identical evidenceKind again with NO evidenceDetail is
      // still allowed — no distinctness check ever runs without it.
      await expect(
        assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure"),
      ).resolves.toBeUndefined();
    });

    it("refuses a repair whose evidenceDetail is IDENTICAL to the immediately-prior repair's, with reason 'evidenceNotDistinct'", async () => {
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
      await assertRepairAllowed(
        store,
        WORK_UNIT_ID,
        "workerResultFailure",
        "diagnostic: connection timed out",
      );
      await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "failed");

      // The SAME evidenceKind AND the SAME evidenceDetail as last time —
      // nothing has genuinely changed.
      await expect(
        assertRepairAllowed(
          store,
          WORK_UNIT_ID,
          "workerResultFailure",
          "diagnostic: connection timed out",
        ),
      ).rejects.toThrow(RepairEvidenceRequiredError);
      try {
        await assertRepairAllowed(
          store,
          WORK_UNIT_ID,
          "workerResultFailure",
          "diagnostic: connection timed out",
        );
        expect.unreachable();
      } catch (err) {
        expect((err as RepairEvidenceRequiredError).reason).toBe("evidenceNotDistinct");
      }
    });

    it("allows a repair whose evidenceDetail DIFFERS from the immediately-prior repair's, even with the same evidenceKind", async () => {
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
      await assertRepairAllowed(
        store,
        WORK_UNIT_ID,
        "workerResultFailure",
        "diagnostic: connection timed out",
      );
      await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_B, "failed");

      await expect(
        assertRepairAllowed(
          store,
          WORK_UNIT_ID,
          "workerResultFailure",
          "diagnostic: a COMPLETELY DIFFERENT failure this time",
        ),
      ).resolves.toBeUndefined();
    });

    it("the very first dispatch is never subject to the distinctness check (no prior evidence exists to compare against)", async () => {
      await expect(
        assertRepairAllowed(store, WORK_UNIT_ID, "none", "irrelevant — first dispatch"),
      ).resolves.toBeUndefined();
    });

    it("MINOR-4-parity: a malformed/foreign repair-evidence-record entry never throws — it is treated as though no prior evidence exists", async () => {
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
      await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
      // A foreign/corrupted adjudication_decision entry that happens to
      // carry the repair-evidence sentinel decision, but whose rationale
      // is not valid JSON at all.
      await store.appendEntry({
        type: "adjudication_decision",
        workUnitId: WORK_UNIT_ID,
        payload: {
          decision: "repair_evidence_record",
          rationale: "not valid json {{{",
          subjectId: WORK_UNIT_ID,
        },
      });

      // Never throws, and — since the malformed entry is skipped rather
      // than treated as "identical prior evidence" — the repair proceeds.
      await expect(
        assertRepairAllowed(
          store,
          WORK_UNIT_ID,
          "workerResultFailure",
          "some fresh diagnostic detail",
        ),
      ).resolves.toBeUndefined();
    });
  });
});

describe("needsRepairPolicyCheck", () => {
  it("is false when no attempt has ever been recorded", async () => {
    expect(await needsRepairPolicyCheck(store, WORK_UNIT_ID)).toBe(false);
  });

  it("is true after a failed attempt", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    expect(await needsRepairPolicyCheck(store, WORK_UNIT_ID)).toBe(true);
  });

  it("is false after a succeeded attempt", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "succeeded");
    expect(await needsRepairPolicyCheck(store, WORK_UNIT_ID)).toBe(false);
  });

  it("is false after a cancelled attempt", async () => {
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "cancelled");
    expect(await needsRepairPolicyCheck(store, WORK_UNIT_ID)).toBe(false);
  });
});

/**
 * Owner ruling R4's FOURTH admissibility bound — "a repair may not enlarge the
 * `PlannedWriteSet`, on pain of re-entering the plan stage in the open"
 * (`docs/design/owner-pipeline-conformance.md` §4.3; roadmap/25 work item 6).
 *
 * ⚠️ WHY THIS LIVES HERE AND NOT IN `admissibility.ts`. That module's own header
 * says so: it implements bounds 1-3 and the fourth "is enforced where a repair's
 * write set is decided, not here", because a pure function over one round's
 * findings has no round-over-round history to compare against. This IS where a
 * repair is decided — the choke point every repair already passes for its
 * attempt count and its evidence distinctness.
 *
 * The bound was documented as living elsewhere and lived nowhere until this
 * suite: defect
 * `docs/evidence/criteria-closeout/defects/25-monotonicity-bound-is-enforced-nowhere.md`
 * records the search that established it, and phase 25's exit criterion is
 * unticked because of it.
 *
 * WHY IT MATTERS RATHER THAN BEING TIDY. `admissibility.ts` concedes that "a
 * repair writes new code inside the write set, and new code carries new
 * obligations", so termination "rests on the repair rate exceeding the
 * new-obligation rate". Monotonicity is the clause that keeps that qualifier
 * bounded: without it the write set itself grows under repair, the obligation
 * space grows with it, and the concession becomes open-ended rather than
 * empirical.
 */
describe("write-set monotonicity (owner ruling R4, bound 4)", () => {
  const SRC = ["packages/cli/src/a.ts", "packages/cli/src/b.ts"];

  it("records nothing and checks nothing when ownedPaths is omitted (backward-compatible)", async () => {
    // The pre-existing four-argument call shape, unchanged. Every current
    // caller that has no packet — `resumeAttempt`'s crash-repair path — keeps
    // working, and gains no silent guarantee it did not ask for.
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure"),
    ).resolves.toBeUndefined();
  });

  it("allows a repair whose write set is IDENTICAL to the prior attempt's", async () => {
    // The ordinary case, and the positive control for everything below: a
    // repair that rewrites the same files must not be refused.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, SRC);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, SRC),
    ).resolves.toBeUndefined();
  });

  it("allows a repair whose write set is NARROWER than the prior attempt's", async () => {
    // Narrowing is the direction the bound wants. Refusing it would push a
    // repair to keep claiming files it no longer touches.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, SRC);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [SRC[0]!]),
    ).resolves.toBeUndefined();
  });

  it("REFUSES a repair that adds a path the prior attempt did not own", async () => {
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, SRC);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [
        ...SRC,
        "packages/gates/src/c.ts",
      ]),
    ).rejects.toThrow(RepairEvidenceRequiredError);
  });

  it("names the widening path in the refusal, not merely that one exists", async () => {
    // A refusal that says "the write set grew" sends the reader to diff two
    // lists by hand. The offending path is what makes it actionable.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, SRC);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    try {
      await assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [
        "packages/gates/src/c.ts",
      ]);
      expect.unreachable("the widening repair should have been refused");
    } catch (error) {
      expect(error).toBeInstanceOf(RepairEvidenceRequiredError);
      expect((error as RepairEvidenceRequiredError).reason).toBe("writeSetWidened");
      expect((error as Error).message).toContain("packages/gates/src/c.ts");
    }
  });

  it("accepts a file UNDER a directory the prior attempt owned", async () => {
    // The prior set owns a directory; a repair narrowing to one file inside it
    // is narrower, not wider. A textual set-difference would refuse this, which
    // is why the check is containment rather than membership.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, [
      "packages/cli/src",
    ]);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [
        "packages/cli/src/deep/nested.ts",
      ]),
    ).resolves.toBeUndefined();
  });

  it("REFUSES a sibling directory whose name merely shares a prefix", async () => {
    // The negative control for the row above. A prefix test done on raw strings
    // admits `packages/cli/src-extra` as a child of `packages/cli/src`, which
    // would let any path be spelled into scope — the same unbounded-space
    // failure `admissibility.ts` exists to close.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, [
      "packages/cli/src",
    ]);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [
        "packages/cli/src-extra/x.ts",
      ]),
    ).rejects.toThrow(RepairEvidenceRequiredError);
  });

  it("compares NORMALIZED paths, so a respelling is not a widening", async () => {
    // `./a//b.ts` and `a/b.ts` are one file. Normalization is the shared
    // `normalizePlannedPath` from `@crabgic/git-engine` — one implementation,
    // which is what roadmap/25's own path-normalization criterion requires.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, ["a/b.ts"]);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [
        "./a//b.ts",
      ]),
    ).resolves.toBeUndefined();
  });

  it("survives a restart, because the prior set is read back from the journal", async () => {
    // The whole reason this is journaled rather than held in memory: a
    // supervisor restart between the attempt and its repair must not reset the
    // bound. A fresh store object over the same directory is that restart.
    await assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, SRC);
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "dispatched");
    await recordAttempt(store, WORK_UNIT_ID, SESSION_A, "failed");
    const restarted = createJournalStore({ journalDir });
    await expect(
      assertRepairAllowed(restarted, WORK_UNIT_ID, "workerResultFailure", "d1", undefined, [
        ...SRC,
        "packages/gates/src/c.ts",
      ]),
    ).rejects.toThrow(RepairEvidenceRequiredError);
  });

  it("does not constrain the FIRST dispatch, which has nothing prior to widen", async () => {
    // A work unit's initial write set is decided by the plan, not by this
    // bound. Refusing here would make the first attempt impossible.
    await expect(
      assertRepairAllowed(store, WORK_UNIT_ID, "none", undefined, undefined, [
        "anything/at/all.ts",
      ]),
    ).resolves.toBeUndefined();
  });
});

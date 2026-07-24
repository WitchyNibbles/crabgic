import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, recordAttempt, type JournalStore } from "@eo/journal";
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

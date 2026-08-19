import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateRegistry } from "./registry.js";
import { allGatesPassed } from "./final-candidate.js";
import type { GateContext, GateVerdict } from "./types.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * ⚠️ THE THIRD STATE — owner ruling 2026-08-18, and the reason it has to exist.
 *
 * A gate has two answers today: passed, or failed. Both are CLAIMS about the
 * candidate. There is a third thing a gate can honestly be in, and the TDD gate
 * lives in it constantly: the check could not be established at all, so the gate
 * has judged nothing.
 *
 * MEASURED, and it is why this landed as a defect rather than a refinement. The
 * shipped TDD gate refuses a candidate with no red baseline. A healthy
 * repository is GREEN at base, so the pre-dispatch run captures no baseline, so
 * the gate refuses — every real run, forever. The gate was satisfiable only when
 * the repository was already broken, which is backwards.
 *
 * ⚠️ AND `passed: true` IS NOT THE FIX. `EvidenceRecord.gateVerdict` is what
 * `@crabgic/cli`'s `deriveGateCriteria` reads to decide `implement-tests-first`,
 * so reporting a pass would derive that criterion as MET on the strength of a
 * check that never ran. The schema already has the right shape for this:
 * `gateVerdict` is OPTIONAL, and that module "deliberately refuses the fallback:
 * for a closure decision, a gate-tagged record with no verdict is unproven
 * rather than presumed green."
 *
 * So `inconclusive` emits a record with NO verdict. Nothing is blocked, and
 * nothing is proved.
 */

const CHANGE_SET_ID = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function contextFor(): GateContext {
  return {
    stage: "verifying",
    changeSetId: CHANGE_SET_ID,
    objectId: OBJECT_ID,
    workUnitId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    journal: tj.store,
    now: () => new Date("2026-08-18T19:00:00.000Z"),
  };
}

function verdict(over: Partial<GateVerdict>): GateVerdict {
  return {
    passed: true,
    command: "stub",
    exitStatus: 0,
    toolchainFingerprint: "stub@1",
    artifactDigests: [],
    detail: "stub",
    ...over,
  };
}

async function fire(v: GateVerdict) {
  const registry = createGateRegistry();
  registry.register("tdd", "stub", () => Promise.resolve(v));
  const results = await registry.fireByTag("tdd", contextFor(), { requireAtLeastOne: true });
  return results[0];
}

describe("inconclusive — the gate ran, established nothing, blocks nothing", () => {
  /**
   * The load-bearing assertion. `deriveGateCriteria` reads `gateVerdict`, and an
   * ABSENT one is what makes the criterion stay underivable. A record carrying
   * `"passed"` here would derive `implement-tests-first` as met on a check that
   * never ran, which is the sycophancy inversion at the exact place a claim is
   * minted.
   */
  it("journals NO gateVerdict, so the derived criterion stays unproven", async () => {
    const result = await fire(verdict({ inconclusive: true }));

    expect(result?.evidence.gateVerdict).toBeUndefined();
  });

  /** It must not block: that is the whole point of the state. */
  it("does not block publication", async () => {
    const result = await fire(verdict({ inconclusive: true }));

    expect(result?.verdict.passed).toBe(true);
    expect(allGatesPassed([result!])).toBe(true);
  });

  /**
   * ⚠️ An ordinary pass is UNCHANGED, and this arm is what stops the flag from
   * quietly erasing every verdict in the system. Without it an implementation
   * that always omitted `gateVerdict` would satisfy the arm above.
   */
  it("leaves an ordinary PASS carrying its verdict", async () => {
    const result = await fire(verdict({ passed: true }));

    expect(result?.evidence.gateVerdict).toBe("passed");
  });

  /** And an ordinary failure still records the failure. */
  it("leaves an ordinary FAILURE carrying its verdict", async () => {
    const result = await fire(verdict({ passed: false, exitStatus: 1 }));

    expect(result?.evidence.gateVerdict).toBe("failed");
    expect(allGatesPassed([result!])).toBe(false);
  });

  /**
   * ⚠️ `inconclusive` OVERRIDES a false `passed`, and says so out loud. A gate
   * that could not establish its precondition has not failed the candidate — it
   * has failed to ask the question. Letting `passed: false` win would put the
   * blocking behaviour straight back.
   */
  it("does not block even when the handler also set passed: false", async () => {
    const result = await fire(verdict({ passed: false, exitStatus: 1, inconclusive: true }));

    expect(result?.verdict.passed).toBe(true);
    expect(result?.evidence.gateVerdict).toBeUndefined();
  });
});

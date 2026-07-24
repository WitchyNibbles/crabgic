import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { allGatesPassed, fireFinalCandidateVerification } from "./final-candidate.js";
import type { GateContext, GateVerdict } from "./types.js";

let tj: TestJournal;
let changeSetId: string;

beforeEach(async () => {
  tj = await createTestJournal();
  changeSetId = randomUUID();
});

afterEach(async () => {
  await tj.cleanup();
});

function verdictFor(passed: boolean): GateVerdict {
  return {
    passed,
    command: "stateful-stub",
    exitStatus: passed ? 0 : 1,
    toolchainFingerprint: "stub@1",
    artifactDigests: [],
    detail: passed ? "passed" : "failed",
  };
}

describe("fireFinalCandidateVerification — work item 6: never trusts a cached per-work-unit result", () => {
  it("rejects a context whose stage is not 'final_verifying'", async () => {
    const registry = createGateRegistry();
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      objectId: "obj",
      journal: tj.store,
    };
    await expect(fireFinalCandidateVerification(registry, context)).rejects.toThrow(
      /final_verifying/,
    );
  });

  it("a per-work-unit gate that already passed against a STALE object id does NOT make the final-candidate re-verification pass against a REGRESSED integrated object id", async () => {
    const STALE_PER_WORK_UNIT_OBJECT_ID = "stale-per-work-unit-obj";
    const REGRESSED_INTEGRATED_OBJECT_ID = "integrated-obj-with-a-regression";

    // A stateful gate: passes ONLY for the stale per-work-unit object id —
    // simulating a check that passed earlier in the run, before integration
    // introduced a regression into the truly-integrated candidate.
    const passingObjectIds = new Set([STALE_PER_WORK_UNIT_OBJECT_ID]);
    const registry = createGateRegistry();
    registry.register("tdd", "stateful-tdd-check", async (context) =>
      verdictFor(passingObjectIds.has(context.objectId)),
    );

    // Step 1: the per-work-unit firing at `verifying`, against the stale
    // object id — legitimately passes, and is journaled.
    const perWorkUnitResults = await registry.fireByTag("tdd", {
      stage: "verifying",
      changeSetId,
      workUnitId: randomUUID(),
      objectId: STALE_PER_WORK_UNIT_OBJECT_ID,
      journal: tj.store,
    });
    expect(perWorkUnitResults[0]?.verdict.passed).toBe(true);

    // Step 2: final-candidate re-verification fires against the TRULY
    // integrated object id — which this gate does NOT consider passing.
    // A naive implementation that reused/trusted the earlier per-work-unit
    // EvidenceRecord (still sitting in the journal, passed=true) would
    // incorrectly report success here; this function has no code path that
    // could do that — it always re-fires.
    const finalResults = await fireFinalCandidateVerification(registry, {
      stage: "final_verifying",
      changeSetId,
      objectId: REGRESSED_INTEGRATED_OBJECT_ID,
      journal: tj.store,
    });

    expect(allGatesPassed(finalResults)).toBe(false);
    expect(finalResults[0]?.verdict.passed).toBe(false);
    expect(finalResults[0]?.evidence.objectId).toBe(REGRESSED_INTEGRATED_OBJECT_ID);

    // The stale per-work-unit EvidenceRecord is STILL there in the journal
    // (unmodified) — proving the failure above isn't from erasing history,
    // but from genuinely re-firing against a different, correct object id.
    let stalePassingStillExists = false;
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (
        entry.type === "evidence_pointer" &&
        entry.payload.objectId === STALE_PER_WORK_UNIT_OBJECT_ID
      ) {
        stalePassingStillExists = entry.payload.exitStatus === 0;
      }
    }
    expect(stalePassingStillExists).toBe(true);
  });

  it("MINOR-1 (adversarial-validation round): an EMPTY registry must fail CLOSED, never silently pass having fired zero gates", async () => {
    const registry = createGateRegistry();
    await expect(
      fireFinalCandidateVerification(registry, {
        stage: "final_verifying",
        changeSetId,
        objectId: "integrated-obj",
        journal: tj.store,
      }),
    ).rejects.toThrow(/zero registered handlers/i);
  });

  it("fires the FULL registered gate set (every tag), never a subset", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "a", async () => verdictFor(true));
    registry.register("coverage", "b", async () => verdictFor(true));
    registry.register("security", "c", async () => verdictFor(true));
    registry.register("flake", "d", async () => verdictFor(true));

    const results = await fireFinalCandidateVerification(registry, {
      stage: "final_verifying",
      changeSetId,
      objectId: "integrated-obj",
      journal: tj.store,
    });
    expect(results.map((r) => r.name).sort()).toEqual(["a", "b", "c", "d"]);
    expect(allGatesPassed(results)).toBe(true);
  });
});

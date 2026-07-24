import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchAttempt } from "@eo/scheduler";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@eo/testkit";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { createGateRegistry } from "./registry.js";
import { allGatesPassed, fireFinalCandidateVerification } from "./final-candidate.js";
import type { GateVerdict } from "./types.js";

/**
 * Fake-engine E2E — roadmap/14 work item 6's own failing-first instruction:
 * "fake-engine E2E where a per-work-unit gate already passed, but ONLY the
 * rerun against the truly-integrated object ID is asserted as the pass
 * condition." This test additionally proves the "dispatched as its own
 * `TaskPacket` through 13's executor" half: the final-candidate
 * verification's OWN outcome is computed first (via
 * `fireFinalCandidateVerification`, this package's pure primitive), then
 * packaged as the `WorkerResult` a `TaskPacket` dispatch through
 * `@eo/scheduler`'s real `dispatchAttempt` reports — proving the wiring
 * point 13 owns (dispatch, `TaskPacket`, model routing) and the wiring
 * point 14 owns (the gate re-fire itself) compose correctly, without this
 * package importing scheduler-internal dispatch logic itself
 * (`./final-candidate.ts`'s own file-level doc comment explains why).
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function verdictFor(passed: boolean): GateVerdict {
  return {
    passed,
    command: "e2e-stub",
    exitStatus: passed ? 0 : 1,
    toolchainFingerprint: "stub@1",
    artifactDigests: [],
    detail: passed ? "passed" : "failed",
  };
}

describe("E2E: final-candidate re-verification dispatched as its own TaskPacket through 13's executor", () => {
  it("a per-work-unit gate already passed against an earlier object id, but the final-candidate TaskPacket's own outcome reflects ONLY the rerun against the truly-integrated object id", async () => {
    const changeSetId = randomUUID();
    const STALE_OBJECT_ID = "stale-per-work-unit-obj";
    const INTEGRATED_OBJECT_ID = "truly-integrated-obj";

    const passingObjectIds = new Set([STALE_OBJECT_ID]);
    const registry = createGateRegistry();
    registry.register("tdd", "stateful-tdd-check", async (context) =>
      verdictFor(passingObjectIds.has(context.objectId)),
    );

    // Earlier: a per-work-unit `verifying`-stage firing already passed.
    const perWorkUnitResults = await registry.fireByTag("tdd", {
      stage: "verifying",
      changeSetId,
      workUnitId: randomUUID(),
      objectId: STALE_OBJECT_ID,
      journal: tj.store,
    });
    expect(perWorkUnitResults[0]?.verdict.passed).toBe(true);

    // Compute the final-candidate verification's real outcome against the
    // TRULY integrated object id.
    const finalResults = await fireFinalCandidateVerification(registry, {
      stage: "final_verifying",
      changeSetId,
      objectId: INTEGRATED_OBJECT_ID,
      journal: tj.store,
    });
    const overallPassed = allGatesPassed(finalResults);
    expect(overallPassed).toBe(false); // the integrated candidate regressed

    // Package that computed outcome as the WorkerResult a dedicated
    // final-candidate WorkUnit's TaskPacket dispatch reports, through
    // @eo/scheduler's REAL dispatchAttempt + FakeEngineAdapter — proving
    // this runs through 13's own executor, not a bespoke code path.
    const workUnitId = randomUUID();
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({
        outcome: overallPassed ? "succeeded" : "failed",
        diagnostics: overallPassed
          ? []
          : finalResults
              .filter((r) => !r.verdict.passed)
              .map((r) => `${r.name}: ${r.verdict.detail}`),
      }),
    });
    const outcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(script),
      journal: tj.store,
      packet: buildTaskPacket({
        workUnitId,
        objective: "Final-candidate gate re-verification",
        gates: ["tdd", "coverage", "flake", "engine-conformance"],
        baseObjectId: INTEGRATED_OBJECT_ID,
      }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    // The dispatched TaskPacket's own outcome reflects ONLY the rerun
    // against the integrated object id — never the earlier stale pass.
    expect(outcome.kind).toBe("failed");
  });

  it("a genuinely clean integrated candidate dispatches to a succeeded TaskPacket outcome", async () => {
    const changeSetId = randomUUID();
    const INTEGRATED_OBJECT_ID = "clean-integrated-obj";
    const registry = createGateRegistry();
    registry.register("tdd", "always-clean", async () => verdictFor(true));
    registry.register("coverage", "always-clean-2", async () => verdictFor(true));

    const finalResults = await fireFinalCandidateVerification(registry, {
      stage: "final_verifying",
      changeSetId,
      objectId: INTEGRATED_OBJECT_ID,
      journal: tj.store,
    });
    const overallPassed = allGatesPassed(finalResults);
    expect(overallPassed).toBe(true);

    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const outcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(script),
      journal: tj.store,
      packet: buildTaskPacket({
        objective: "Final-candidate gate re-verification",
        gates: ["tdd", "coverage"],
        baseObjectId: INTEGRATED_OBJECT_ID,
      }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).toBe("succeeded");
  });
});

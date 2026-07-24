import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchAttempt } from "@eo/scheduler";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@eo/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "../test-support/minimal-compiled-profile.js";
import { createTestJournal, type TestJournal } from "../test-support/test-journal.js";
import { MIN_INTERLEAVED_REPETITIONS } from "./methodology.js";
import { runTwinWorktreeBenchmark } from "./twin-worktree-runner.js";

/**
 * Fake-engine E2E — roadmap/15 work item 4's own failing-first instruction:
 * "fake-engine E2E with a scripted, deterministic benchmark command proving
 * exact interleaving order before any real stack adapter exists." Proves
 * this package's `dispatchWorktree` injection point composes correctly with
 * `@eo/scheduler`'s REAL `dispatchAttempt` + `FakeEngineAdapter` (mirroring
 * `packages/gates/src/final-candidate.e2e.test.ts`'s identical pattern) —
 * i.e. 13's own worktree-provisioning wiring is real, even though the
 * "worktree path" itself is a fixture-known constant here (see
 * `./twin-worktree-runner.ts`'s own doc comment for why: `dispatchAttempt`
 * does not yet return the full `SessionRef`, only `sessionId`).
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

const BASE_WORKTREE = "/fake/base-worktree";
const CANDIDATE_WORKTREE = "/fake/candidate-worktree";

function makeDispatchWorktree() {
  return async (params: { side: "base" | "candidate"; objectId: string }) => {
    const worktreePath = params.side === "base" ? BASE_WORKTREE : CANDIDATE_WORKTREE;
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: tj.store,
      packet: buildTaskPacket({
        workUnitId: randomUUID(),
        objective: `Benchmark repetition dispatch (${params.side})`,
        baseObjectId: params.objectId,
      }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    if (outcome.kind !== "succeeded") {
      throw new Error(`unexpected dispatch outcome: ${outcome.kind}`);
    }
    return { worktreePath, sessionId: outcome.sessionId };
  };
}

/** A scripted, deterministic "benchmark command": base is always 100, candidate is always 105 — no randomness at all, proving the SCHEDULE (not the numbers) is what this test is about. */
async function scriptedDeterministicMeasure(params: {
  side: "base" | "candidate";
}): Promise<number> {
  return params.side === "base" ? 100 : 105;
}

describe("E2E: twin-worktree A/B runner dispatches through 13's executor with exact interleaving order", () => {
  it("dispatches each repetition through the REAL @eo/scheduler dispatchAttempt, in strict base/candidate alternating order", async () => {
    const observedOrder: string[] = [];
    const dispatchWorktree = makeDispatchWorktree();

    const result = await runTwinWorktreeBenchmark({
      baseObjectId: "base-object-id",
      candidateObjectId: "candidate-object-id",
      benchmarkCommand: "scripted-deterministic-bench",
      warmupRepetitions: 1,
      dispatchWorktree: async (params) => {
        observedOrder.push(`${params.phase}:${params.side}`);
        return dispatchWorktree(params);
      },
      measure: scriptedDeterministicMeasure,
    });

    expect(observedOrder[0]).toBe("warmup:base");
    expect(observedOrder[1]).toBe("warmup:candidate");
    for (let i = 0; i < MIN_INTERLEAVED_REPETITIONS; i += 1) {
      expect(observedOrder[2 + i * 2]).toBe("measured:base");
      expect(observedOrder[2 + i * 2 + 1]).toBe("measured:candidate");
    }

    expect(result.baseSamples.every((s) => s.value === 100)).toBe(true);
    expect(result.candidateSamples.every((s) => s.value === 105)).toBe(true);
    expect(result.baseSamples).toHaveLength(MIN_INTERLEAVED_REPETITIONS);
    expect(result.candidateSamples).toHaveLength(MIN_INTERLEAVED_REPETITIONS);
  });

  it("DETERMINISM: running the identical twin-worktree benchmark twice produces a byte-identical schedule and sample set (excluding wall-clock timestamps)", async () => {
    const runOnce = async () => {
      const dispatchWorktree = makeDispatchWorktree();
      const result = await runTwinWorktreeBenchmark({
        baseObjectId: "base-object-id",
        candidateObjectId: "candidate-object-id",
        benchmarkCommand: "scripted-deterministic-bench",
        warmupRepetitions: 1,
        dispatchWorktree,
        measure: scriptedDeterministicMeasure,
        nowMs: () => 0, // pin wall-clock so timestamps don't differ across runs
      });
      return {
        schedule: result.schedule,
        baseValues: result.baseSamples.map((s) => s.value),
        candidateValues: result.candidateSamples.map((s) => s.value),
      };
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(second).toEqual(first);
  });
});

import { describe, expect, it } from "vitest";
import { MethodologyViolationError } from "../errors.js";
import { MIN_INTERLEAVED_REPETITIONS } from "./methodology.js";
import { runTwinWorktreeBenchmark } from "./twin-worktree-runner.js";

function stubDispatch(worktreePath: string) {
  return async () => ({ worktreePath, sessionId: "session-1" });
}

describe("runTwinWorktreeBenchmark", () => {
  it("REFUSES (typed error) when repetitions is below the minimum — no dispatch/measure call ever happens", async () => {
    let dispatchCalls = 0;
    await expect(
      runTwinWorktreeBenchmark({
        baseObjectId: "base-obj",
        candidateObjectId: "candidate-obj",
        benchmarkCommand: "bench",
        repetitions: MIN_INTERLEAVED_REPETITIONS - 1,
        dispatchWorktree: async () => {
          dispatchCalls += 1;
          return { worktreePath: "/tmp/wt", sessionId: "s" };
        },
        measure: async () => 1,
      }),
    ).rejects.toThrow(MethodologyViolationError);
    expect(dispatchCalls).toBe(0);
  });

  it("runs the default warmup (1 per side) followed by exactly MIN_INTERLEAVED_REPETITIONS measured reps per side, strictly alternating", async () => {
    const callOrder: string[] = [];
    const result = await runTwinWorktreeBenchmark({
      baseObjectId: "base-obj",
      candidateObjectId: "candidate-obj",
      benchmarkCommand: "bench",
      dispatchWorktree: async (params) => {
        callOrder.push(`${params.phase}:${params.side}`);
        return { worktreePath: `/tmp/${params.side}`, sessionId: `s-${params.side}` };
      },
      measure: async (params) => (params.side === "base" ? 100 : 105),
    });

    expect(result.baseSamples).toHaveLength(MIN_INTERLEAVED_REPETITIONS);
    expect(result.candidateSamples).toHaveLength(MIN_INTERLEAVED_REPETITIONS);
    expect(result.schedule).toHaveLength(2 + 2 * MIN_INTERLEAVED_REPETITIONS); // 1 warmup pair + N measured pairs

    // Warmup pair first, then strictly alternating measured pairs.
    expect(callOrder[0]).toBe("warmup:base");
    expect(callOrder[1]).toBe("warmup:candidate");
    for (let i = 0; i < MIN_INTERLEAVED_REPETITIONS; i += 1) {
      expect(callOrder[2 + i * 2]).toBe("measured:base");
      expect(callOrder[2 + i * 2 + 1]).toBe("measured:candidate");
    }

    expect(result.baseSamples.every((s) => s.value === 100)).toBe(true);
    expect(result.candidateSamples.every((s) => s.value === 105)).toBe(true);
  });

  it("never runs concurrently: base and candidate dispatch/measure calls never overlap in wall-clock time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await runTwinWorktreeBenchmark({
      baseObjectId: "base-obj",
      candidateObjectId: "candidate-obj",
      benchmarkCommand: "bench",
      warmupRepetitions: 0,
      dispatchWorktree: stubDispatch("/tmp/wt"),
      measure: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return 1;
      },
    });
    expect(maxInFlight).toBe(1);
    expect(result.baseSamples).toHaveLength(MIN_INTERLEAVED_REPETITIONS);
  });

  it("respects a custom repetition/warmup count", async () => {
    const result = await runTwinWorktreeBenchmark({
      baseObjectId: "base-obj",
      candidateObjectId: "candidate-obj",
      benchmarkCommand: "bench",
      repetitions: 15,
      warmupRepetitions: 3,
      dispatchWorktree: stubDispatch("/tmp/wt"),
      measure: async () => 1,
    });
    expect(result.baseSamples).toHaveLength(15);
    expect(result.candidateSamples).toHaveLength(15);
    expect(result.schedule).toHaveLength(2 * 3 + 2 * 15);
  });
});

import { MethodologyViolationError } from "../errors.js";
import {
  assertMethodologySound,
  MIN_INTERLEAVED_REPETITIONS,
  type ScheduleStep,
  type ScheduleStepKind,
} from "./methodology.js";

export interface ResourceSample {
  readonly side: ScheduleStepKind;
  readonly repetitionIndex: number;
  readonly value: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

export interface DispatchWorktreeParams {
  readonly side: ScheduleStepKind;
  readonly objectId: string;
  readonly phase: "warmup" | "measured";
  readonly repetitionIndex: number;
}

export interface DispatchedWorktree {
  readonly worktreePath: string;
  readonly sessionId: string;
}

export interface MeasureParams {
  readonly side: ScheduleStepKind;
  readonly worktreePath: string;
  readonly command: string;
}

/**
 * Twin-worktree A/B runner — roadmap/15 §In scope, "Twin-worktree A/B
 * runner": "dispatches through 13's executor into per-attempt worktrees;
 * warmup + ≥10 interleaved repetitions."
 *
 * DEPENDENCY-DIRECTION NOTE (mirrors `@eo/gates`'s `final-candidate.ts`'s
 * own file-level doc comment for the identical reason): this module has NO
 * import of `@eo/scheduler` — worktree provisioning is 13's job
 * (dispatched through its executor, 13's own dependency on 07), and this
 * phase "never spawns a worker or calls `packages/git-engine` itself"
 * (roadmap/15 §Out of scope). `dispatchWorktree`/`measure` are injected by
 * the CALLER, who is expected to implement `dispatchWorktree` on top of
 * `@eo/scheduler`'s real `dispatchAttempt` (see
 * `./twin-worktree-runner.e2e.test.ts`, which proves exactly this
 * composition against a real `FakeEngineAdapter`/`dispatchAttempt`, mirroring
 * `packages/gates/src/final-candidate.e2e.test.ts`'s own pattern). This
 * keeps the ORDERING/INTERLEAVING guarantee (this file's real
 * responsibility) fully unit-testable with zero engine/scheduler
 * dependency, while still proving the real composition works end-to-end in
 * a dedicated E2E test.
 *
 * CARRY-FORWARD (documented, not silently papered over):
 * `@eo/scheduler`'s `dispatchAttempt` returns only `sessionId` on its
 * `DispatchAttemptOutcome`, not the full `SessionRef` (which alone carries
 * `worktreePath`) — so a REAL (non-test) `dispatchWorktree` implementation
 * needs an additional worktree-path resolution 13 does not yet expose on
 * that return type. This is exactly why `dispatchWorktree` is an injection
 * point on this module's own public API rather than a direct
 * `dispatchAttempt` call inside it: a future extension to 13's own
 * `DispatchAttemptOutcome` (or an additional lookup) can supply the real
 * resolution without changing this package's API at all.
 *
 * CONCURRENCY (never concurrent, roadmap/15 §Critical correctness points):
 * enforced BY CONSTRUCTION — every `dispatchWorktree`/`measure` call is
 * `await`ed in sequence before the next repetition begins; there is no
 * code path in this function that starts repetition N+1 before repetition
 * N's `measure()` promise has resolved.
 */
export interface RunTwinWorktreeBenchmarkOptions {
  readonly baseObjectId: string;
  readonly candidateObjectId: string;
  readonly benchmarkCommand: string;
  /** Measured repetitions PER SIDE. Must be `>= MIN_INTERLEAVED_REPETITIONS`, or `assertMethodologySound` refuses with a typed `MethodologyViolationError` before any dispatch happens. */
  readonly repetitions?: number;
  /** Warmup repetitions per side, run before the measured schedule and excluded from it entirely. Default 1. */
  readonly warmupRepetitions?: number;
  readonly dispatchWorktree: (params: DispatchWorktreeParams) => Promise<DispatchedWorktree>;
  readonly measure: (params: MeasureParams) => Promise<number>;
  readonly nowMs?: () => number;
}

export interface RunTwinWorktreeBenchmarkResult {
  readonly schedule: readonly ScheduleStep[];
  readonly baseSamples: readonly ResourceSample[];
  readonly candidateSamples: readonly ResourceSample[];
}

export async function runTwinWorktreeBenchmark(
  options: RunTwinWorktreeBenchmarkOptions,
): Promise<RunTwinWorktreeBenchmarkResult> {
  const repetitions = options.repetitions ?? MIN_INTERLEAVED_REPETITIONS;
  if (repetitions < MIN_INTERLEAVED_REPETITIONS) {
    throw new MethodologyViolationError(
      "too_few_repetitions",
      `requested ${String(repetitions)} repetitions per side; need >= ${String(MIN_INTERLEAVED_REPETITIONS)}`,
    );
  }
  const warmup = options.warmupRepetitions ?? 1;
  const nowMs = options.nowMs ?? (() => Date.now());

  const schedule: ScheduleStep[] = [];
  const baseSamples: ResourceSample[] = [];
  const candidateSamples: ResourceSample[] = [];

  async function runOne(
    side: ScheduleStepKind,
    phase: "warmup" | "measured",
    repetitionIndex: number,
  ): Promise<void> {
    const objectId = side === "base" ? options.baseObjectId : options.candidateObjectId;
    const dispatched = await options.dispatchWorktree({ side, objectId, phase, repetitionIndex });
    const startedAtMs = nowMs();
    const value = await options.measure({
      side,
      worktreePath: dispatched.worktreePath,
      command: options.benchmarkCommand,
    });
    const endedAtMs = nowMs();

    schedule.push({ kind: side, phase });
    if (phase === "measured") {
      const sample: ResourceSample = { side, repetitionIndex, value, startedAtMs, endedAtMs };
      (side === "base" ? baseSamples : candidateSamples).push(sample);
    }
  }

  for (let w = 0; w < warmup; w += 1) {
    await runOne("base", "warmup", w);
    await runOne("candidate", "warmup", w);
  }
  for (let i = 0; i < repetitions; i += 1) {
    await runOne("base", "measured", i);
    await runOne("candidate", "measured", i);
  }

  // Defensive, fail-closed re-check of the schedule this loop just built —
  // by construction it always alternates and always meets the floor, but
  // this keeps the invariant enforced by an independently-testable
  // function rather than "trust the loop above."
  assertMethodologySound(schedule);

  return { schedule, baseSamples, candidateSamples };
}

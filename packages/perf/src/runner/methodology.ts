import { MethodologyViolationError } from "../errors.js";

/**
 * ≥10 interleaved repetitions — roadmap/15 §In scope, "Methodology":
 * "≥10 interleaved repetitions (A/B alternating base/candidate, never
 * concurrent)." Read as ≥10 repetitions PER SIDE (10 base + 10 candidate =
 * 20 measured samples total) — this phase's own documented interpretation
 * of "repetitions" as one full A/B round, since no source material pins
 * whether the "10" counts total steps or per-side rounds (see
 * docs/evidence/phase-15/README.md).
 */
export const MIN_INTERLEAVED_REPETITIONS = 10;

export type ScheduleStepKind = "base" | "candidate";
export type ScheduleStepPhase = "warmup" | "measured";

export interface ScheduleStep {
  readonly kind: ScheduleStepKind;
  readonly phase: ScheduleStepPhase;
}

/**
 * Validates a completed (or about-to-be-executed) A/B schedule against
 * roadmap/15's own methodology requirements. Only `phase: "measured"` steps
 * count toward the repetition floor and the strict-alternation check;
 * `"warmup"` steps are exempt (framework-appropriate warmup is required,
 * but not itself part of the interleaved measurement).
 *
 * Throws `MethodologyViolationError` (typed, never a silent pass/fail) —
 * roadmap/15 §Critical correctness points: "a benchmark methodology
 * violation (too few reps, no interleave) REFUSES to produce a verdict."
 */
export function assertMethodologySound(schedule: readonly ScheduleStep[]): void {
  const measured = schedule.filter((step) => step.phase === "measured");
  const baseCount = measured.filter((step) => step.kind === "base").length;
  const candidateCount = measured.filter((step) => step.kind === "candidate").length;

  if (baseCount < MIN_INTERLEAVED_REPETITIONS || candidateCount < MIN_INTERLEAVED_REPETITIONS) {
    throw new MethodologyViolationError(
      "too_few_repetitions",
      `base=${String(baseCount)} candidate=${String(candidateCount)} measured repetitions; ` +
        `need >= ${String(MIN_INTERLEAVED_REPETITIONS)} of each`,
    );
  }

  for (let i = 1; i < measured.length; i += 1) {
    const prev = measured[i - 1];
    const current = measured[i];
    if (prev !== undefined && current !== undefined && prev.kind === current.kind) {
      throw new MethodologyViolationError(
        "not_interleaved",
        `two consecutive "${current.kind}" measured repetitions at position ${String(i)} — ` +
          "the schedule must strictly alternate base/candidate, never run as two separate blocks",
      );
    }
  }
}

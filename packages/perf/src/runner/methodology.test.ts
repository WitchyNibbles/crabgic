import { describe, expect, it } from "vitest";
import { MethodologyViolationError } from "../errors.js";
import {
  assertMethodologySound,
  MIN_INTERLEAVED_REPETITIONS,
  type ScheduleStep,
} from "./methodology.js";

function alternatingSchedule(reps: number): ScheduleStep[] {
  const schedule: ScheduleStep[] = [];
  for (let i = 0; i < reps; i += 1) {
    schedule.push({ kind: "base", phase: "measured" });
    schedule.push({ kind: "candidate", phase: "measured" });
  }
  return schedule;
}

describe("assertMethodologySound", () => {
  it("accepts a strictly-alternating schedule with exactly the minimum repetitions", () => {
    expect(() =>
      assertMethodologySound(alternatingSchedule(MIN_INTERLEAVED_REPETITIONS)),
    ).not.toThrow();
  });

  it("accepts warmup steps preceding the measured schedule, and ignores them for both checks", () => {
    const schedule: ScheduleStep[] = [
      { kind: "base", phase: "warmup" },
      { kind: "base", phase: "warmup" }, // two consecutive warmup "base" steps — fine, warmup is exempt
      { kind: "candidate", phase: "warmup" },
      ...alternatingSchedule(MIN_INTERLEAVED_REPETITIONS),
    ];
    expect(() => assertMethodologySound(schedule)).not.toThrow();
  });

  it("REFUSES (typed error) when there are too few repetitions", () => {
    let caught: unknown;
    try {
      assertMethodologySound(alternatingSchedule(MIN_INTERLEAVED_REPETITIONS - 1));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MethodologyViolationError);
    expect((caught as InstanceType<typeof MethodologyViolationError>).reason).toBe(
      "too_few_repetitions",
    );
  });

  it("REFUSES (typed error) when the schedule is a block design (all base, then all candidate) rather than interleaved", () => {
    const schedule: ScheduleStep[] = [
      ...Array.from({ length: MIN_INTERLEAVED_REPETITIONS }, (): ScheduleStep => ({
        kind: "base",
        phase: "measured",
      })),
      ...Array.from({ length: MIN_INTERLEAVED_REPETITIONS }, (): ScheduleStep => ({
        kind: "candidate",
        phase: "measured",
      })),
    ];
    let caught: unknown;
    try {
      assertMethodologySound(schedule);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MethodologyViolationError);
    expect((caught as InstanceType<typeof MethodologyViolationError>).reason).toBe(
      "not_interleaved",
    );
  });

  it("REFUSES when even a single pair of consecutive same-kind measured reps appears in an otherwise-fine schedule", () => {
    const schedule = alternatingSchedule(MIN_INTERLEAVED_REPETITIONS);
    // Break alternation once: duplicate the first "base" step immediately after itself.
    schedule.splice(1, 0, { kind: "base", phase: "measured" });
    expect(() => assertMethodologySound(schedule)).toThrow(MethodologyViolationError);
  });

  it("empty schedule is too few repetitions, not a false 'not_interleaved' pass", () => {
    let caught: unknown;
    try {
      assertMethodologySound([]);
    } catch (error) {
      caught = error;
    }
    expect((caught as InstanceType<typeof MethodologyViolationError>).reason).toBe(
      "too_few_repetitions",
    );
  });
});

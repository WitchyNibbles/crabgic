import { describe, expect, it } from "vitest";
import {
  CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT,
  CRITICAL_PATH_REGRESSION_THRESHOLD_PCT,
  decide,
  SENSITIVE_PATH_REGRESSION_THRESHOLD_PCT,
} from "./decision-engine.js";

const CONSTANT_BASE = Array<number>(12).fill(100); // zero-variance -> noiseBoundPct === 0

// Base is a constant 100, so "N% above base" is exactly `100 + N` — computed
// this way (rather than `100 * (1 + N / 100)`) to avoid floating-point
// rounding noise (e.g. `100 * 1.1` is `110.00000000000001` in IEEE 754,
// which would wrongly push an "exactly 10%" boundary case a hair past 10).
function candidateAt(pctAboveBase: number): number[] {
  return Array<number>(12).fill(100 + pctAboveBase);
}

describe("decide — critical-path 5% boundary (exact)", () => {
  it("a regression of EXACTLY 5% on a critical path PASSES (not 'beyond')", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(CRITICAL_PATH_REGRESSION_THRESHOLD_PCT),
      pathSensitivity: "critical",
    });
    expect(result.regressionPct).toBeCloseTo(5, 6);
    expect(result.thresholdPct).toBe(5);
    expect(result.outcome).toBe("pass");
  });

  it("a regression of 5.0001% on a critical path BLOCKS", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(5.0001),
      pathSensitivity: "critical",
    });
    expect(result.outcome).toBe("block");
  });
});

describe("decide — sensitive-path 10% boundary (exact)", () => {
  it("a regression of EXACTLY 10% on a sensitive path PASSES", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(SENSITIVE_PATH_REGRESSION_THRESHOLD_PCT),
      pathSensitivity: "sensitive",
    });
    expect(result.regressionPct).toBeCloseTo(10, 6);
    expect(result.thresholdPct).toBe(10);
    expect(result.outcome).toBe("pass");
  });

  it("a regression of 10.0001% on a sensitive path BLOCKS", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(10.0001),
      pathSensitivity: "sensitive",
    });
    expect(result.outcome).toBe("block");
  });
});

describe("decide — critical-path 15% noise boundary (exact, via noiseBoundPctOverride)", () => {
  it("noise of EXACTLY 15% on a critical path is NOT inconclusive — falls through to max(15,5)=15% block-threshold logic", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(12), // below the resulting 15% threshold
      pathSensitivity: "critical",
      noiseBoundPctOverride: CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT,
    });
    expect(result.outcome).not.toBe("inconclusive_blocking");
    expect(result.thresholdPct).toBe(15);
    expect(result.outcome).toBe("pass");
  });

  it("noise of 15.0001% on a critical path IS inconclusive-and-blocking", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(1), // trivial regression — irrelevant, noise dominates
      pathSensitivity: "critical",
      noiseBoundPctOverride: 15.0001,
    });
    expect(result.outcome).toBe("inconclusive_blocking");
  });

  it("high noise on a SENSITIVE path (not critical) is never inconclusive — only critical-path gets that rule", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(1),
      pathSensitivity: "sensitive",
      noiseBoundPctOverride: 50,
    });
    expect(result.outcome).not.toBe("inconclusive_blocking");
    // regression (1%) is within max(noise 50%, 10%) = 50% -> passes
    expect(result.outcome).toBe("pass");
  });
});

describe("decide — absolute-budget breach", () => {
  it("blocks unconditionally when the candidate mean breaches an absolute budget, even with zero regression", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: CONSTANT_BASE, // zero regression
      pathSensitivity: "sensitive",
      absoluteBudget: 50, // candidate mean (100) > budget (50)
    });
    expect(result.outcome).toBe("block");
    expect(result.reason).toMatch(/absolute budget breached/);
  });

  it("does not block on an absolute budget that is not breached — falls through to statistical rules", () => {
    const result = decide({
      metric: "cpu_time",
      baseSamples: CONSTANT_BASE,
      candidateSamples: CONSTANT_BASE,
      pathSensitivity: "sensitive",
      absoluteBudget: 500,
    });
    expect(result.outcome).toBe("pass");
  });

  it("for a lower-is-worse metric (throughput), a candidate mean BELOW the budget breaches", () => {
    const result = decide({
      metric: "throughput",
      baseSamples: CONSTANT_BASE,
      candidateSamples: CONSTANT_BASE,
      pathSensitivity: "sensitive",
      absoluteBudget: 150, // candidate mean (100) < budget (150) -> breach
    });
    expect(result.outcome).toBe("block");
  });
});

describe("decide — an improvement never blocks", () => {
  it("a candidate mean below base (higher-is-worse metric) passes regardless of path sensitivity", () => {
    const result = decide({
      metric: "latency",
      baseSamples: CONSTANT_BASE,
      candidateSamples: candidateAt(-20),
      pathSensitivity: "critical",
    });
    expect(result.outcome).toBe("pass");
  });
});

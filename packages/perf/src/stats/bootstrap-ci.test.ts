import { describe, expect, it } from "vitest";
import { InsufficientSamplesError } from "../errors.js";
import { computeNoiseBoundPct, computeRegressionPct } from "./bootstrap-ci.js";

describe("computeNoiseBoundPct", () => {
  it("a constant (zero-variance) sample set has a noise bound of exactly 0", () => {
    const samples = Array(12).fill(100);
    expect(computeNoiseBoundPct(samples)).toBe(0);
  });

  it("a higher-variance sample set has a strictly larger noise bound than a lower-variance one of the same mean", () => {
    const low = [98, 99, 100, 101, 102, 99, 100, 101, 100, 100, 99, 101];
    const high = [60, 140, 80, 120, 50, 150, 70, 130, 90, 110, 40, 160];
    expect(computeNoiseBoundPct(high)).toBeGreaterThan(computeNoiseBoundPct(low));
  });

  it("throws InsufficientSamplesError for fewer than 2 samples", () => {
    expect(() => computeNoiseBoundPct([100])).toThrow(InsufficientSamplesError);
    expect(() => computeNoiseBoundPct([])).toThrow(InsufficientSamplesError);
  });

  it("is deterministic: two calls over the identical sample array produce byte-identical output", () => {
    const samples = [10, 12, 11, 13, 9, 10, 14, 11, 12, 10];
    expect(computeNoiseBoundPct(samples)).toBe(computeNoiseBoundPct(samples));
  });

  it("is order-independent: shuffling the input array produces the identical noise bound", () => {
    const samples = [10, 12, 11, 13, 9, 10, 14, 11, 12, 10];
    const shuffled = [13, 10, 9, 12, 10, 14, 11, 10, 12, 11];
    expect(computeNoiseBoundPct(samples)).toBe(computeNoiseBoundPct(shuffled));
  });

  it("respects a custom seed (still deterministic, but a documented override point)", () => {
    const samples = [10, 12, 11, 13, 9, 10, 14, 11, 12, 10];
    const a = computeNoiseBoundPct(samples, { seed: 1 });
    const b = computeNoiseBoundPct(samples, { seed: 1 });
    expect(a).toBe(b);
  });
});

describe("computeRegressionPct", () => {
  it("higher-is-worse: a candidate mean above the base mean is a positive regression", () => {
    expect(computeRegressionPct([100, 100], [110, 110], true)).toBeCloseTo(10, 10);
  });

  it("higher-is-worse: a candidate mean below the base mean is a negative regression (an improvement)", () => {
    expect(computeRegressionPct([100, 100], [90, 90], true)).toBeCloseTo(-10, 10);
  });

  it("lower-is-worse (e.g. throughput): a candidate mean BELOW the base mean is a positive regression", () => {
    expect(computeRegressionPct([100, 100], [90, 90], false)).toBeCloseTo(10, 10);
  });

  it("lower-is-worse: a candidate mean ABOVE the base mean is a negative regression (an improvement)", () => {
    expect(computeRegressionPct([100, 100], [110, 110], false)).toBeCloseTo(-10, 10);
  });

  it("a zero base mean is handled without dividing by zero", () => {
    expect(computeRegressionPct([0, 0], [10, 10], true)).toBe(0);
  });
});

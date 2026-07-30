/**
 * Exact binomial bounds. The published Clopper–Pearson values below are the
 * reference this implementation is checked against — they are not derived from
 * it, which is the only way a numeric routine's test means anything.
 */
import { describe, expect, it } from "vitest";
import { binomialCdf, exactLowerBound } from "./binomial-bounds.js";

describe("binomialCdf", () => {
  it("is 1 at or above n trials and 0 below zero successes", () => {
    expect(binomialCdf(5, 5, 0.3)).toBe(1);
    expect(binomialCdf(-1, 5, 0.3)).toBe(0);
  });

  it("matches a hand-computed distribution", () => {
    // Binomial(3, 0.5): P(X<=0)=1/8, P(X<=1)=4/8, P(X<=2)=7/8.
    expect(binomialCdf(0, 3, 0.5)).toBeCloseTo(0.125, 10);
    expect(binomialCdf(1, 3, 0.5)).toBeCloseTo(0.5, 10);
    expect(binomialCdf(2, 3, 0.5)).toBeCloseTo(0.875, 10);
  });

  it("handles the degenerate p values without producing NaN", () => {
    expect(binomialCdf(2, 5, 0)).toBe(1);
    expect(binomialCdf(2, 5, 1)).toBe(0);
  });
});

describe("exactLowerBound", () => {
  /**
   * PUBLISHED reference values for the one-sided 95% Clopper–Pearson lower
   * bound. Each is the number that decides whether a recall claim is provable
   * at that sample size, which is exactly why the gate's floors are set where
   * they are: 8/8 perfect cannot support "recall >= 0.7", and 15/15 can.
   */
  it.each([
    [8, 8, 0.688],
    [12, 12, 0.779],
    [15, 15, 0.819],
    [20, 20, 0.861],
    [19, 20, 0.784],
    [29, 30, 0.851],
  ])("bounds %i/%i at ~%f", (successes, trials, expected) => {
    expect(exactLowerBound(successes, trials, 0.05)).toBeCloseTo(expected, 2);
  });

  it("returns 0 for zero successes — no evidence is not weak evidence", () => {
    expect(exactLowerBound(0, 20, 0.05)).toBe(0);
  });

  it("returns 0 for an empty sample rather than dividing by zero", () => {
    expect(exactLowerBound(0, 0, 0.05)).toBe(0);
  });

  it("never exceeds the point estimate", () => {
    for (const [k, n] of [
      [1, 2],
      [7, 10],
      [45, 50],
      [99, 100],
    ] as const) {
      expect(exactLowerBound(k, n, 0.05)).toBeLessThanOrEqual(k / n);
    }
  });

  it("rises with sample size at a fixed proportion — more evidence, tighter bound", () => {
    const small = exactLowerBound(9, 10, 0.05);
    const medium = exactLowerBound(90, 100, 0.05);
    const large = exactLowerBound(900, 1000, 0.05);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
  });

  it("is conservative relative to the normal approximation at small n", () => {
    // The whole reason this module exists: a Wald bound is optimistic here.
    const k = 18;
    const n = 20;
    const phat = k / n;
    const wald = phat - 1.645 * Math.sqrt((phat * (1 - phat)) / n);
    expect(exactLowerBound(k, n, 0.05)).toBeLessThan(wald);
  });

  it("uses the closed form for all-successes, matching alpha^(1/n)", () => {
    expect(exactLowerBound(12, 12, 0.05)).toBeCloseTo(0.05 ** (1 / 12), 10);
  });

  it("honours alpha — a stricter confidence level gives a lower bound", () => {
    expect(exactLowerBound(18, 20, 0.01)).toBeLessThan(exactLowerBound(18, 20, 0.05));
  });
});

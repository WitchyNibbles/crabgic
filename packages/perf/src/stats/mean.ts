/**
 * The ONE shared `mean()` implementation for this package —
 * adversarial-validation MINOR-3 fix: `gate/performance-gate.ts` used to
 * compute its `measuredValue` via an UNSORTED `reduce`, inconsistent with
 * the deliberately-sorted `mean()` this package's stats layer relies on
 * for true order-independence (`stats/bootstrap-ci.ts`/`stats/
 * decision-engine.ts` previously each had their OWN local copy of the
 * identical sorted implementation — now both import this single one, and
 * the gate handler uses it too, so there is exactly one "how do we average
 * a sample set" answer anywhere in this package).
 *
 * Sorts before summing — floating-point addition is not associative, so
 * summing the SAME multiset of values in a different order can differ by a
 * few ULPs. Sorting first makes `mean()` a true function of the sample
 * MULTISET alone: two arrays that are permutations of each other produce a
 * BYTE-IDENTICAL mean, not merely a statistically-equivalent one.
 */
export function mean(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
}

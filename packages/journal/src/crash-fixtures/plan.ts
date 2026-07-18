/**
 * Shared randomized-plan scaffolding for `crash-suite.test.ts` and
 * `crash-suite-rotation.test.ts` (VALIDATION ROUND 2026-07-18 fix: split
 * out when the rotation variant was added, to keep both test files under
 * this repo's 400-line-file convention).
 */

export interface IterationPlan {
  readonly dir: string;
  readonly mode: "append" | "snapshot";
  readonly entryCountBefore: number;
  readonly faultPoint: string;
}

/**
 * Deterministic seeded PRNG — reproducible plans given the same seed,
 * logged in the evidence capture for anyone who wants to replay a specific
 * run. Uses `Math.imul` (true 32-bit integer multiplication) rather than
 * plain `*` — a plain `state * 1103515245` overflows JS's 53-bit float
 * mantissa for `state` values above ~8.1M, silently losing low-order bits
 * and producing a badly degenerate sequence (verified empirically: an
 * earlier `state * 1103515245` version of this function always produced
 * `pick(2) === 0` for this file's own default seed, biasing every
 * iteration's plan to the same mode/fault point). `Math.imul` computes the
 * product using real 32-bit semantics, matching a standard LCG.
 */
export function createPrng(seed: number): (max: number) => number {
  let state = seed >>> 0 || 1;
  return (max: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state % max;
  };
}

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide } from "./decision-engine.js";

/**
 * roadmap/15 §Test plan, Property: "fast-check over randomized interleaved
 * sample sequences — verdict classification is order-independent (base/
 * candidate interleaving order never changes the outcome) and monotonic in
 * regression magnitude."
 */

const sampleArb = fc.array(fc.double({ min: 1, max: 1000, noNaN: true }), {
  minLength: 4,
  maxLength: 20,
});

/**
 * MINOR-2 fix (adversarial-validation round): the original version of this
 * property only ever compared a sample array against its OWN `.reverse()`
 * — a fixed, single permutation. A bug depending on which specific element
 * sits in the MIDDLE of the array (rather than merely "first vs last")
 * could slip past a reverse-only check undetected. This arbitrary instead
 * `.chain()`s off the generated sample array into a GENUINELY RANDOM
 * full-length permutation of it (`fc.shuffledSubarray` with
 * `minLength === maxLength === array.length`, i.e. every element kept,
 * order fully randomized) — fast-check explores many distinct shuffles
 * across the property's `numRuns`, not one fixed reordering.
 */
function withRandomPermutation(
  arr: readonly number[],
): fc.Arbitrary<readonly [readonly number[], readonly number[]]> {
  return fc
    .shuffledSubarray([...arr], { minLength: arr.length, maxLength: arr.length })
    .map((permuted) => [arr, permuted] as const);
}

const sampleWithPermutationArb = sampleArb.chain((arr) => withRandomPermutation(arr));

describe("decide — order-independence property", () => {
  it("a GENUINE RANDOM PERMUTATION of the base and/or candidate sample arrays never changes the resulting outcome/regressionPct/noiseBoundPct", () => {
    fc.assert(
      fc.property(
        sampleWithPermutationArb,
        sampleWithPermutationArb,
        fc.constantFrom("critical", "sensitive"),
        ([base, shuffledBase], [candidate, shuffledCandidate], sensitivity) => {
          const a = decide({
            metric: "cpu_time",
            baseSamples: base,
            candidateSamples: candidate,
            pathSensitivity: sensitivity,
          });
          const b = decide({
            metric: "cpu_time",
            baseSamples: shuffledBase,
            candidateSamples: shuffledCandidate,
            pathSensitivity: sensitivity,
          });

          expect(b).toEqual(a);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("decide — monotonicity in regression magnitude property", () => {
  it("holding base samples/noise fixed, a LARGER regression never un-blocks a decision that was already blocking (pass -> block is the only permitted transition as regression grows)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 50, max: 150, noNaN: true }), { minLength: 6, maxLength: 20 }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (base, deltaA, deltaB) => {
          const [smaller, larger] = deltaA <= deltaB ? [deltaA, deltaB] : [deltaB, deltaA];
          const baseMean = base.reduce((s, v) => s + v, 0) / base.length;
          if (baseMean <= 0) return; // degenerate; skip

          const candidateSmaller = base.map((v) => v * (1 + smaller / 100));
          const candidateLarger = base.map((v) => v * (1 + larger / 100));

          const resultSmaller = decide({
            metric: "cpu_time",
            baseSamples: base,
            candidateSamples: candidateSmaller,
            pathSensitivity: "sensitive",
          });
          const resultLarger = decide({
            metric: "cpu_time",
            baseSamples: base,
            candidateSamples: candidateLarger,
            pathSensitivity: "sensitive",
          });

          // "sensitive" path sensitivity never enters the inconclusive_blocking
          // branch (that rule is critical-path only), so only pass/block occur.
          if (resultSmaller.outcome === "block") {
            expect(resultLarger.outcome).toBe("block");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

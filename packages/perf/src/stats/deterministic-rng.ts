/**
 * A tiny, fully deterministic PRNG (mulberry32) — used ONLY so this
 * package's bootstrap resampling (`./bootstrap-ci.ts`) is a PURE function
 * of its (sorted) sample input, never of wall-clock/`Math.random()`
 * entropy. This is what makes two independent runs over the SAME archived
 * samples produce a byte-identical verdict (roadmap/15 exit criterion:
 * "Verdicts reproducible from archived samples alone, byte-identical on
 * re-derivation") and what makes verdict classification provably
 * order-independent in how base/candidate samples were originally
 * interleaved (roadmap/15 §Test plan, Property) — see `./bootstrap-ci.ts`'s
 * own doc comment for why sorting + a fixed seed together are sufficient.
 */
export function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** This package's own fixed default seed — deliberately a constant, never derived from wall-clock time, so the default bootstrap is reproducible without a caller having to pass a seed explicitly. */
export const DEFAULT_BOOTSTRAP_SEED = 0x5eed_1234;

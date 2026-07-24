import { InsufficientSamplesError } from "../errors.js";
import { createDeterministicRng, DEFAULT_BOOTSTRAP_SEED } from "./deterministic-rng.js";
import { mean } from "./mean.js";

function resampleWithReplacement(sorted: readonly number[], rng: () => number): number[] {
  const out: number[] = new Array<number>(sorted.length);
  for (let i = 0; i < sorted.length; i += 1) {
    const index = Math.floor(rng() * sorted.length);
    out[i] = sorted[Math.min(index, sorted.length - 1)] as number;
  }
  return out;
}

export interface BootstrapNoiseBoundOptions {
  /** Number of bootstrap iterations. Default 2000. */
  readonly iterations?: number;
  /** Which percentile of the bootstrapped |delta%| distribution to report as the noise bound. Default 95. */
  readonly percentile?: number;
  /** Overridable seed, for tests wanting a DIFFERENT (still deterministic) sequence than the package default. */
  readonly seed?: number;
}

/**
 * Bootstrap-CI noise bound — roadmap/15 §In scope, "Decision rules": "Stats
 * module (bootstrap-CI noise bound, documented method)." METHOD (documented
 * here, per the roadmap's own "documented method" requirement): resample
 * the BASE revision's own samples into two independent groups (with
 * replacement) many times; for each iteration compute the absolute percent
 * difference between the two groups' means. Because BOTH groups are drawn
 * from the SAME base-revision population, any non-zero delta this produces
 * is, by construction, pure measurement noise (there is no true regression
 * between a population and itself) — the requested percentile of this
 * distribution (default: 95th) is reported as the "noise bound": how much
 * apparent regression could plausibly arise from measurement noise alone,
 * at this repetition count and this host's variance.
 *
 * DETERMINISM (roadmap/15 exit criterion: "verdicts reproducible from
 * archived samples alone, byte-identical on re-derivation"): the input is
 * SORTED before resampling (so the result depends only on the sample
 * MULTISET, never on original collection order — satisfying the
 * order-independence property too), and the RNG is a fixed-seed
 * deterministic generator (`./deterministic-rng.ts`), never
 * `Math.random()`. The whole function is therefore a PURE function of its
 * (sorted) input: re-deriving from the same archived samples with the same
 * default seed always reproduces the identical noise-bound figure.
 */
export function computeNoiseBoundPct(
  baseSamples: readonly number[],
  options: BootstrapNoiseBoundOptions = {},
): number {
  if (baseSamples.length < 2) {
    throw new InsufficientSamplesError("base", baseSamples.length);
  }
  const sorted = [...baseSamples].sort((a, b) => a - b);
  const iterations = options.iterations ?? 2000;
  const percentile = options.percentile ?? 95;
  const rng = createDeterministicRng(options.seed ?? DEFAULT_BOOTSTRAP_SEED);

  const deltas: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const groupA = resampleWithReplacement(sorted, rng);
    const groupB = resampleWithReplacement(sorted, rng);
    const meanA = mean(groupA);
    const meanB = mean(groupB);
    const deltaPct = meanA === 0 ? 0 : Math.abs((meanB - meanA) / meanA) * 100;
    deltas.push(deltaPct);
  }
  deltas.sort((a, b) => a - b);
  const rank = Math.min(
    deltas.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * deltas.length) - 1),
  );
  return deltas[rank] as number;
}

/** Direction-aware regression percentage between two sample sets — see `./metric-direction.ts` for the `higherIsWorse` convention. Positive = worse (a regression); negative = an improvement. */
export function computeRegressionPct(
  baseSamples: readonly number[],
  candidateSamples: readonly number[],
  higherIsWorse: boolean,
): number {
  const baseMean = mean(baseSamples);
  const candidateMean = mean(candidateSamples);
  const rawPct = baseMean === 0 ? 0 : ((candidateMean - baseMean) / baseMean) * 100;
  return higherIsWorse ? rawPct : -rawPct;
}

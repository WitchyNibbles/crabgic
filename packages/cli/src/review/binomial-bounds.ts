/**
 * Exact one-sided lower confidence bounds for a binomial proportion
 * (Clopper–Pearson), plus the binomial CDF they are derived from.
 *
 * WHY EXACT, AND WHY HERE (2026-07-30). The calibration gate decides whether a
 * classifier may close a review stage, on corpora of tens of samples. The normal
 * approximation it used for kappa is documented in `./calibration.ts` as
 * understating variance at small n — optimistic exactly where optimism is least
 * warranted — and the literature is blunt about it: do not use the CLT for
 * evaluation intervals below a few hundred datapoints. A per-class recall claim
 * ("this classifier catches at least 70% of real blockers") is the number the
 * pipeline actually depends on, so it gets an exact bound rather than an
 * approximate one.
 *
 * Clopper–Pearson is conservative by construction — its coverage is at least the
 * nominal level, never below — which is the correct direction for a gate. It also
 * behaves at the edges where a normal interval is nonsense: 0 successes, or all
 * successes, both produce a meaningful bound.
 *
 * NO DEPENDENCY, AND NO RANDOMNESS. The bound is the beta quantile
 * `B(alpha; k, n-k+1)`, but rather than pull in an incomplete-beta
 * implementation this inverts the binomial CDF by bisection: the exact same
 * quantity, since `P(X >= k | p) = alpha` at the Clopper–Pearson lower bound.
 * Deterministic, so a gate verdict is reproducible — a bootstrap would put a
 * random number generator inside a release decision.
 */

/**
 * `P(X <= k)` for `X ~ Binomial(n, p)`, summed in LOG space.
 *
 * The naive recurrence — start at `(1-p)^n` and multiply up — is what this
 * replaced, and it silently returns garbage at moderate n: for `n = 1000` and
 * `p ~ 0.88`, `(1-p)^n` underflows to exactly 0, every subsequent term is
 * `0 * something`, and the sum is 0. A CDF of 0 makes the bisection in
 * `exactLowerBound` converge on a meaningless answer with no error and no NaN.
 * Caught by this module's own monotonicity property (a bound must tighten as
 * evidence grows), which is the only reason it was not shipped.
 *
 * Log-sum-exp keeps every term representable regardless of n, at the cost of one
 * pass to find the largest term. Log-factorials are accumulated iteratively
 * rather than via a gamma function, because Node has no `lgamma` and the
 * recurrence is exact for the magnitudes involved.
 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;

  const logP = Math.log(p);
  const logQ = Math.log1p(-p);

  // logTerm(i) = log C(n, i) + i*log(p) + (n-i)*log(1-p), built by recurrence:
  // log C(n, i) = log C(n, i-1) + log(n-i+1) - log(i).
  const logTerms: number[] = [];
  let logBinomial = 0; // log C(n, 0)
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) logBinomial += Math.log(n - i + 1) - Math.log(i);
    logTerms.push(logBinomial + i * logP + (n - i) * logQ);
  }

  const maxLog = Math.max(...logTerms);
  if (!Number.isFinite(maxLog)) return 0;
  let scaled = 0;
  for (const logTerm of logTerms) scaled += Math.exp(logTerm - maxLog);
  return Math.min(1, Math.exp(maxLog) * scaled);
}

/**
 * The exact (Clopper–Pearson) one-sided lower confidence bound for `successes`
 * out of `trials`, at confidence `1 - alpha`.
 *
 * `alpha` is the ONE-SIDED tail. A "95% lower bound" is `alpha = 0.05`, not
 * `0.025` — the distinction the kappa interval in `./calibration.ts` gets wrong
 * by reusing a two-sided z quantile, which makes that bound a 97.5% one rather
 * than the 95% its name claims.
 */
export function exactLowerBound(successes: number, trials: number, alpha = 0.05): number {
  if (trials <= 0) return 0;
  if (successes <= 0) return 0;
  if (successes >= trials) {
    // All successes: the bound is `alpha^(1/n)`, the closed form of the same
    // inversion, and worth stating exactly rather than bisecting to it.
    return alpha ** (1 / trials);
  }

  // Find p such that P(X >= successes | p) = alpha, i.e.
  // 1 - P(X <= successes-1 | p) = alpha. The left side rises monotonically in
  // p, so bisection converges from any bracketing pair.
  let low = 0;
  let high = successes / trials; // the point estimate always exceeds the lower bound
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const tail = 1 - binomialCdf(successes - 1, trials, mid);
    if (tail < alpha) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

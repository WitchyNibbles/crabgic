import { type PerformanceMetric } from "./performance-contract.js";

/**
 * Which direction is "worse" for each `PerformanceMetric` — needed to turn a
 * raw mean-shift into a signed "regression" percentage (roadmap/15 never pins
 * this directly; it is phase 15's own minimal-sufficient reading of each
 * metric's plain-English meaning, documented rather than silently assumed).
 * `throughput`/`capacity` are the only two members where a DECREASE is the
 * regression; every other metric is worse when it goes UP.
 *
 * ── RELOCATED FROM `packages/perf` (2026-08-01) ─────────────────────────────
 *
 * This lives beside `PERFORMANCE_METRICS` now for the same reason
 * `./budget-sourcing.ts` does (ledger Gap 21): a SECOND consumer appeared on
 * the other side of the phase graph. `./acceptance-criteria-parser.ts` — run by
 * phase 11's intake — needs the canonical direction to reject a criterion whose
 * comparison operator contradicts it, and phase 11 cannot depend on phase 15.
 * `packages/perf` re-exports `higherIsWorse` verbatim, so its published surface
 * and its own tests are unchanged.
 *
 * Keeping it here also makes the totality that phase 15's gate relies on
 * structural: the function is total over the closed 13-member metric enum
 * because the set below is a subset of it, and both are declared in this
 * package.
 */
const LOWER_IS_WORSE_METRICS: ReadonlySet<PerformanceMetric> = new Set(["throughput", "capacity"]);

/** `true` iff a HIGHER measured value is worse for `metric` (the common case: latency/cpu_time/peak_rss/... going up is a regression). */
export function higherIsWorse(metric: PerformanceMetric): boolean {
  return !LOWER_IS_WORSE_METRICS.has(metric);
}

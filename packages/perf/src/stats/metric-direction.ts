import type { PerformanceMetric } from "@eo/contracts";

/**
 * Which direction is "worse" for each `PerformanceMetric` — needed to turn
 * a raw mean-shift into a signed "regression" percentage (roadmap/15 never
 * pins this directly; it is this phase's own minimal-sufficient reading of
 * each metric's plain-English meaning, documented here rather than
 * silently assumed). `throughput`/`capacity` are the only two members
 * where a DECREASE is the regression; every other metric is worse when it
 * goes UP.
 */
const LOWER_IS_WORSE_METRICS: ReadonlySet<PerformanceMetric> = new Set(["throughput", "capacity"]);

/** `true` iff a HIGHER measured value is worse for `metric` (the common case: latency/cpu_time/peak_rss/... going up is a regression). */
export function higherIsWorse(metric: PerformanceMetric): boolean {
  return !LOWER_IS_WORSE_METRICS.has(metric);
}

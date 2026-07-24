/**
 * `getrusage`-style self-measurement — roadmap/15 §In scope, "Resource
 * capture": "`getrusage` wrappers around the benchmarked … processes."
 * Node's own `process.resourceUsage()` IS Node's documented binding to
 * POSIX `getrusage(RUSAGE_SELF)` — this module wraps it rather than
 * hand-rolling a native addon, and is used by `../adapters/node-harness-
 * adapter.ts`'s in-process self-report (the benchmarked Node process
 * measures ITSELF at the end of its own run, the most direct realization
 * of `getrusage` available without a native binding).
 *
 * SECURITY: returns ONLY numeric resource-usage fields — no field here can
 * ever carry environment/argv content (roadmap/15 §Critical correctness
 * points, "Secret-leakage").
 */
export interface SelfRusageSample {
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly maxRssKb: number;
}

/** `process.resourceUsage()` reports CPU time in MICROSECONDS and `maxRSS` already in kilobytes (Linux `ru_maxrss` convention) — converted here to this module's millisecond/kilobyte convention. */
export function captureSelfRusage(): SelfRusageSample {
  const usage = process.resourceUsage();
  return {
    cpuUserMs: usage.userCPUTime / 1000,
    cpuSystemMs: usage.systemCPUTime / 1000,
    maxRssKb: usage.maxRSS,
  };
}

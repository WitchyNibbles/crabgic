/**
 * Self-contained resource probe — roadmap/05-supervisor-daemon.md §Idle
 * resource budget: "a SELF-CONTAINED `/proc`/`process.resourceUsage()`/
 * `process.memoryUsage()`-style probe of THIS process alone (NOT a
 * `packages/perf` benchmark)." Deliberately measures only `process.*`
 * built-ins — no child-process spawning, no A/B twin-worktree harness (15's
 * scope), and no environment/secret content is ever captured (roadmap 05
 * §Security: "idle-budget measurement captures no environment/secret
 * content" — this module reads exactly two Node built-ins and nothing
 * else).
 */

export interface ResourceSample {
  /** Resident set size, in bytes (`process.memoryUsage().rss`). */
  readonly rssBytes: number;
  /** Cumulative user CPU time, in microseconds, since process start (`process.resourceUsage().userCPUTime`). */
  readonly cpuUserMicros: number;
  /** Cumulative system CPU time, in microseconds, since process start (`process.resourceUsage().systemCPUTime`). */
  readonly cpuSystemMicros: number;
  /** Wall-clock instant this sample was taken, in epoch milliseconds. */
  readonly sampledAtMs: number;
}

/** Takes one instantaneous sample of THIS process's own RSS + cumulative CPU time. No I/O, no child processes, no environment content. */
export function sampleResourceUsage(): ResourceSample {
  const memory = process.memoryUsage();
  const usage = process.resourceUsage();
  return {
    rssBytes: memory.rss,
    cpuUserMicros: usage.userCPUTime,
    cpuSystemMicros: usage.systemCPUTime,
    sampledAtMs: Date.now(),
  };
}

/** Fraction of one CPU core consumed between two samples (0 = idle, 1 = one full core saturated for the whole interval). */
export function cpuFractionBetween(previous: ResourceSample, current: ResourceSample): number {
  const cpuDeltaMicros =
    current.cpuUserMicros -
    previous.cpuUserMicros +
    (current.cpuSystemMicros - previous.cpuSystemMicros);
  const wallDeltaMicros = (current.sampledAtMs - previous.sampledAtMs) * 1000;
  if (wallDeltaMicros <= 0) return 0;
  return cpuDeltaMicros / wallDeltaMicros;
}

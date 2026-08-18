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

/**
 * The idle CPU budget: **<1% of one core**, stated in that wording three times in
 * `roadmap/05-supervisor-daemon.md` (`:25`, `:51`, `:122`) and nowhere set as a number.
 *
 * ⚠️ DECLARED HERE, ONCE, BECAUSE IT WAS DECLARED TWICE. Until 2026-08-18 both
 * `idle-budget.integration.test.ts` and `heartbeat-scheduler.test.ts` carried their own
 * private `const CPU_BUDGET_FRACTION = 0.01;`. Two copies of one budget is invisible to
 * every suite — both files passed — so the duplication could only ever have been caught by
 * a reader who happened to open both. `one-cpu-budget-declaration.test.ts` now makes the
 * reappearance of a private copy a red test instead.
 *
 * It lives in the PRODUCTION module rather than in either test because that is this
 * repository's dominant pattern (measured: 104 test files import an upper-case constant
 * from a sibling production module; no `*.test.ts` file exports a constant), and because
 * the nearest prior art is in this very directory — `heartbeat-scheduler.ts`'s
 * `HEARTBEAT_INTERVAL_MS`, the 5 s peer of this number, declared in production and imported
 * by the sibling test.
 *
 * ⚠️ NOT the only declaration of this threshold in the repository, and deliberately so.
 * `e2e/attestation/src/performanceContracts.ts` declares
 * `SUPERVISOR_IDLE_CPU_FRACTION_BUDGET = 0.01` for its own package, and the owner ruled the
 * collapse reaches two sites, not three — that file is a separate change set with a
 * separate approval, and `one-cpu-budget-declaration.test.ts` is scoped to this directory
 * so it can never grow into a demand to merge it.
 *
 * The VALUE is not this constant's to change. `docs/evidence/gap-18/known-gate-flakes.md`
 * records this bound breaching on unloaded hosts, and recalibrating it is tracked at
 * `docs/evidence/criteria-closeout/defects/05-idle-budget-arm-not-calibrated-for-its-channel.md`
 * — a measurement, not a refactor.
 */
export const CPU_BUDGET_FRACTION = 0.01;

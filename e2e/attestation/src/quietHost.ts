import { readFile } from "node:fs/promises";
import { cpus } from "node:os";

/**
 * Quiet-host probe — roadmap/23 Exit criteria: "Performance contracts
 * satisfied rather than skipped, **measured on a quiet host** (15)", and
 * roadmap/23 §In scope: "Supervisor idle-budget re-measurement (05's
 * <100 MiB RSS / <1% core / 5 s heartbeat numbers) on a quiet host, per
 * 05's and 15's own deferred notes."
 *
 * Both 05 and 15 deferred this and nothing in `packages/perf` implements
 * it: there was no way to tell a genuine measurement from one taken on a
 * host that happened to be busy. That gap matters in exactly one direction
 * — a noisy host inflates latency and CPU samples, so a contract measured
 * on one either fails spuriously or, worse, passes while measuring
 * something other than the software.
 *
 * WHAT "QUIET" MEANS HERE, and why the interval is closed rather than
 * sampled once: a host can be quiet at the moment sampling starts and busy
 * halfway through. `probeQuietHost` returns a sampler whose verdict covers
 * the whole measured span.
 *
 * A non-quiet host does NOT produce a fabricated failure of the contract
 * under test. It produces `inconclusive_blocking` — 15's own canonical
 * outcome for "the measurement could not decide" — which still blocks the
 * release, because an undecidable performance contract is precisely what
 * "satisfied rather than skipped" forbids.
 */

/** Linux `/proc/stat`'s first line: aggregated jiffies across all CPUs. */
export interface ProcStatCpuTimes {
  readonly idle: number;
  readonly total: number;
}

export interface QuietHostThresholds {
  /** Maximum 1-minute load average PER CORE. */
  readonly maxLoadPerCore: number;
  /** Minimum fraction of CPU time spent idle across the measured interval. */
  readonly minIdleFraction: number;
}

/**
 * Deliberately conservative. A release measurement is taken once, so the
 * cost of waiting for a genuinely quiet host is far lower than the cost of
 * recording a number that does not mean what it says.
 */
export const DEFAULT_QUIET_HOST_THRESHOLDS: QuietHostThresholds = {
  maxLoadPerCore: 0.5,
  minIdleFraction: 0.8,
};

/** Parses the aggregate `cpu` line of `/proc/stat` into idle and total jiffies. */
export function parseProcStat(content: string): ProcStatCpuTimes {
  const line = content.split("\n").find((candidate) => candidate.startsWith("cpu "));
  if (line === undefined) throw new Error("quiet-host probe: /proc/stat has no aggregate cpu line");
  const fields = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number.parseInt(value, 10));
  // Fields: user nice system idle iowait irq softirq steal guest guest_nice.
  // `idle` and `iowait` both represent time the CPU was not doing work.
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
  const total = fields.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return { idle, total };
}

/** Parses the 1-minute load average out of `/proc/loadavg`. */
export function parseLoadAvg(content: string): number {
  const first = content.trim().split(/\s+/)[0];
  const parsed = Number.parseFloat(first ?? "");
  if (!Number.isFinite(parsed)) throw new Error("quiet-host probe: unparseable /proc/loadavg");
  return parsed;
}

/** Idle fraction across the interval between two `/proc/stat` samples. */
export function computeIdleFraction(before: ProcStatCpuTimes, after: ProcStatCpuTimes): number {
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  // A zero-length interval carries no information; reporting it as fully
  // idle would let a zero-duration probe certify any host as quiet.
  if (totalDelta <= 0) return 0;
  return idleDelta / totalDelta;
}

export interface QuietHostAssessment {
  readonly quiet: boolean;
  readonly loadPerCore: number;
  readonly idleFraction: number;
  readonly reasons: readonly string[];
}

/** Pure judgement — every input injected, so both verdicts are testable on any host. */
export function assessQuietHost(
  loadAverage1: number,
  coreCount: number,
  idleFraction: number,
  thresholds: QuietHostThresholds = DEFAULT_QUIET_HOST_THRESHOLDS,
): QuietHostAssessment {
  const loadPerCore = coreCount > 0 ? loadAverage1 / coreCount : loadAverage1;
  const reasons: string[] = [];

  if (loadPerCore > thresholds.maxLoadPerCore) {
    reasons.push(
      `1-minute load average is ${loadPerCore.toFixed(2)} per core, above the ` +
        `${thresholds.maxLoadPerCore} quiet-host limit.`,
    );
  }
  if (idleFraction < thresholds.minIdleFraction) {
    reasons.push(
      `the host was only ${(idleFraction * 100).toFixed(1)}% idle across the measured interval, ` +
        `below the ${(thresholds.minIdleFraction * 100).toFixed(0)}% quiet-host floor.`,
    );
  }

  return { quiet: reasons.length === 0, loadPerCore, idleFraction, reasons };
}

export interface QuietHostSampler {
  /** Closes the interval opened by `probeQuietHost` and judges the whole span. */
  finish: () => Promise<QuietHostAssessment>;
}

/**
 * Opens a quiet-host measurement interval. Call `finish()` once the
 * measurement under test has completed; the verdict then covers the entire
 * span, not a single instant.
 */
export async function probeQuietHost(
  thresholds: QuietHostThresholds = DEFAULT_QUIET_HOST_THRESHOLDS,
): Promise<QuietHostSampler> {
  const before = parseProcStat(await readFile("/proc/stat", "utf-8"));
  return {
    finish: async () => {
      const after = parseProcStat(await readFile("/proc/stat", "utf-8"));
      const loadAverage1 = parseLoadAvg(await readFile("/proc/loadavg", "utf-8"));
      return assessQuietHost(
        loadAverage1,
        cpus().length,
        computeIdleFraction(before, after),
        thresholds,
      );
    },
  };
}

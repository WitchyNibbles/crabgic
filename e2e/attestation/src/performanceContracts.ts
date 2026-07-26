import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PERFORMANCE_OUTCOMES } from "@eo/contracts";
import type { PerformanceMetric, PerformanceOutcome } from "@eo/contracts";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";
import { probeQuietHost, type QuietHostAssessment } from "./quietHost.js";

/**
 * `performance-contracts` — roadmap/23 Exit criteria: "Performance
 * contracts satisfied rather than skipped, measured on a quiet host (15)",
 * and §In scope: "Supervisor idle-budget re-measurement (05's <100 MiB RSS
 * / <1% core / 5 s heartbeat numbers) on a quiet host, per 05's and 15's
 * own deferred notes."
 *
 * THAT IS TWO OBLIGATIONS AGAINST ONE CHECKLIST ITEM. This module MEASURES
 * the first (05's idle budget) and READS a record of the second
 * (`PERFORMANCE_RERUN_RECORD_PATH`), blocking while that record is absent
 * rather than reporting a PASS whose scope caveat lives in a detail line no
 * verdict consumer reads. The block is evidence-driven, not a constant: no
 * such record exists in this repository today, and the item clears when one
 * appears rather than when someone edits this file.
 *
 * SELF-CONTAINED BY SPEC, NOT BY PREFERENCE. roadmap/15:38 places the
 * supervisor idle-resource budget out of 15's scope in as many words:
 * "owned end-to-end by 05 … not a PerformanceContract, never routed through
 * `packages/perf`". roadmap/05:38 says the same from the other side: "this
 * phase's idle-budget probe is a separate, self-contained measurement of
 * its own process, not a `packages/perf` benchmark", and 05:108 records
 * that 05 deliberately follows 15's text. An earlier revision of this file
 * routed both budgets through `packages/perf`'s `decide()`; that was a spec
 * violation, and `inconclusive_blocking` was its symptom, not its cause.
 *
 * WHAT WENT WRONG, CONCRETELY. `decide()` reaches `computeNoiseBoundPct`,
 * which bootstraps a RELATIVE delta of the resampled mean. The idle CPU
 * series is per-poll rates derived from INTEGER tick deltas, so it is
 * mostly zeros with an occasional one-tick blip; a relative bound over a
 * zero-heavy series lands at 100%, and a critical-path bound above 15% is
 * `inconclusive_blocking` by 15's own rule. The measured cost was ~4x
 * inside the budget the whole time. Nothing about `decide()` is wrong —
 * it was being asked a question it does not exist to answer.
 *
 * THIS MODULE THEREFORE COMPARES ABSOLUTELY, against 05's two documented
 * numbers, using statistics it computes itself:
 *
 * - **CPU: `totalTicks / (CLOCK_TICKS_PER_SECOND * elapsedWallSeconds)`.**
 *   With equal poll intervals this is EXACTLY the arithmetic mean of the
 *   per-interval rates — it is not immune to quantization and no claim is
 *   made that it differs from a mean. It is chosen because it is the
 *   budget's OWN definition ("<1% of one core" over a sustained window) and
 *   because it quantizes at whole-window rather than per-sample resolution:
 *   over a 16 s window one tick is 1/(100*16) = 0.000625, i.e. 6.25% of the
 *   budget. A 1.5 s burst at a full core is 150 ticks = 9.4% of a core and
 *   is caught; a 100 ms burst is not, which is correct for an AVERAGE idle
 *   budget.
 * - **RSS: the maximum sampled CURRENT RSS.** Not because "a mean lets
 *   excursions hide" — within one boot this daemon's RSS is byte-identical
 *   at every sample, so max and mean coincide. It is chosen because the
 *   budget is a CEILING and a maximum is the faithful reading of one.
 *
 * LIMITS, STATED RATHER THAN PAPERED OVER:
 *
 * - **Linux only.** The probe reads `/proc/<pid>/{stat,status}` and pins
 *   `CLOCK_TICKS_PER_SECOND = 100`, which is ABI-fixed for `/proc` on Linux
 *   x86-64 and aarch64. On a host without `/proc` no sample is ever taken
 *   and every contract is `inconclusive_blocking` — never a silent pass.
 * - **Single boot.** This measurement boots the daemon once. The historical
 *   flakiness of this budget was ACROSS boots (104.7 -> 113.9 MiB -> under
 *   budget), which a single-boot maximum does not address. The RSS
 *   statistic therefore names itself "across a single boot" in the emitted
 *   detail line, so no reader mistakes it for a cross-boot ceiling.
 *
 * A NOISY HOST NEVER YIELDS A PASS. If the quiet-host probe reports the
 * measurement window was contended, every contract is reported
 * `inconclusive_blocking` regardless of the numbers observed — an
 * undecidable contract is what "satisfied rather than skipped" forbids.
 *
 * The outcome vocabulary is unchanged: `pass | block |
 * inconclusive_blocking`, the canonical `PERFORMANCE_OUTCOMES` defined in
 * 02's `packages/contracts` (the three names are quoted from roadmap/15,
 * but the symbol and its schema are 02's, not 15's). Only the DERIVATION is
 * local.
 */

/** 05 §Idle resource budget: "<100 MiB RSS". */
export const SUPERVISOR_IDLE_RSS_BUDGET_BYTES = 100 * 1024 * 1024;
/** 05 §Idle resource budget: "<1% core". */
export const SUPERVISOR_IDLE_CPU_FRACTION_BUDGET = 0.01;
/** 05 §Idle resource budget: "5 s heartbeats". */
export const SUPERVISOR_IDLE_HEARTBEAT_MS = 5_000;
/**
 * 05's exit criterion asks for a measurement "over a sustained no-op
 * window". One heartbeat is not sustained: at 6 000 ms the window spanned
 * exactly one, so essentially all of the daemon's idle CPU cost fell in
 * whichever single poll interval the heartbeat landed in. 16 000 ms spans
 * three heartbeats and gives the whole-window CPU aggregate 6.25%-of-budget
 * resolution.
 */
export const SUPERVISOR_IDLE_WINDOW_MS = 16_000;

export interface ReleasePerformanceBudget {
  readonly contractId: string;
  readonly metric: PerformanceMetric;
  readonly absoluteBudget: number;
  /** Where the number comes from — never an invented threshold. */
  readonly rationale: string;
}

export const RELEASE_PERFORMANCE_BUDGETS: readonly ReleasePerformanceBudget[] = [
  {
    contractId: "supervisor-idle-rss",
    metric: "peak_rss",
    absoluteBudget: SUPERVISOR_IDLE_RSS_BUDGET_BYTES,
    rationale: "roadmap/05 §Idle resource budget: supervisor idle RSS < 100 MiB.",
  },
  {
    contractId: "supervisor-idle-cpu",
    metric: "cpu_time",
    absoluteBudget: SUPERVISOR_IDLE_CPU_FRACTION_BUDGET,
    rationale: "roadmap/05 §Idle resource budget: supervisor idle CPU < 1% of one core.",
  },
];

/**
 * One idle measurement of one daemon boot.
 *
 * Carries the ENDPOINTS the CPU aggregate needs (ticks consumed and the
 * wall span they were consumed over), not a pre-reduced per-poll rate
 * series: the sampling loop stops early if the daemon exits, so the
 * aggregate must be taken over the span actually observed rather than the
 * span requested.
 */
export interface SupervisorIdleMeasurement {
  /** Current RSS at each poll, in bytes. Empty when `/proc/<pid>/status` never yielded `VmRSS`. */
  readonly rssSamplesBytes: readonly number[];
  /** utime+stime consumed between the first and last poll actually observed. */
  readonly cpuTicksConsumed: number;
  /** Wall-clock milliseconds those ticks were consumed over. */
  readonly observedSpanMs: number;
  /** Polls that returned a sample inside the window. */
  readonly sampleCount: number;
  readonly quietHost: QuietHostAssessment;
  /** Non-empty when the daemon could not be measured at all. */
  readonly failures: readonly string[];
  /**
   * How the daemon this probe booted was torn down; absent only when no
   * daemon was ever spawned. REPORTED rather than kept internal so the
   * teardown is assertable: without it, deleting the `SIGTERM` from
   * `measureSupervisorIdle` leaves every test in this suite green while
   * leaking a live supervisor per release run.
   */
  readonly teardown?: SupervisorTeardown;
}

/** What ending one booted daemon took. */
export interface SupervisorTeardown {
  /** The pid that was signalled. */
  readonly pid: number;
  /**
   * `true` when SIGTERM alone did not end the process inside
   * `SUPERVISOR_TEARDOWN_GRACE_MS` and a SIGKILL was needed. A probe that
   * always needs one is a different fact about the daemon than one that
   * never does, so it is recorded rather than smoothed over.
   */
  readonly escalatedToSigkill: boolean;
}

/**
 * Linux's `sysconf(_SC_CLK_TCK)` as seen through `/proc`: ABI-fixed at 100
 * on x86-64 and aarch64 regardless of the kernel's own `CONFIG_HZ`. There
 * is no portable way to read the true value from Node without a native
 * addon, and this probe is `/proc`-only by construction, so this is a
 * pinned, documented assumption rather than a guess.
 */
export const CLOCK_TICKS_PER_SECOND = 100;
/**
 * Poll cadence. 16 000 / 250 = 64 polls across the window.
 *
 * Exported so the real-daemon test can derive its poll-count floor from the
 * window and the cadence together. Pinning `SUPERVISOR_IDLE_WINDOW_MS` alone
 * proves only that a constant holds a value, not that the probe runs it.
 */
export const SAMPLE_INTERVAL_MS = 250;
/**
 * The measurement is only meaningful over at least one full heartbeat
 * interval — below that the window can fall entirely between two
 * heartbeats and report an idle cost of exactly zero for a daemon that has
 * one. The sampling loop breaks when the daemon exits, so a short span is a
 * real, reachable condition and must be `inconclusive_blocking`.
 */
export const SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS = SUPERVISOR_IDLE_HEARTBEAT_MS;
/** The poll count that span implies, so a stalled sampler is caught as well as a short one. */
export const SUPERVISOR_IDLE_MIN_SAMPLES =
  SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS / SAMPLE_INTERVAL_MS;
/**
 * Startup is excluded from the measurement, mirroring
 * `packages/perf/src/runner/methodology.ts`'s own warmup phase, which is
 * run before the measured schedule and excluded from it entirely.
 *
 * This is not a tuning knob — without it the probe is simply measuring the
 * wrong thing. 05 budgets the daemon's IDLE cost, but a window opened at
 * spawn captures module loading, socket bind and lease acquisition: the
 * first run of this probe reported 123% of a core against a 1% budget,
 * which is a true statement about booting and a false one about idling.
 *
 * EXPORTED so its value can be pinned to a literal, and so the DEFAULT can
 * be exercised. Every caller in the test suite once supplied `warmupMs`
 * explicitly, which pins only the injected parameter: rewriting this
 * constant to `0` left the whole suite green, i.e. the paragraph above was
 * documentation of a property nothing enforced.
 */
export const STARTUP_WARMUP_MS = 2_500;

/** A single `/proc/<pid>` reading of the daemon. */
export interface IdleProcSample {
  /** utime + stime, in clock ticks, cumulative since process start. */
  readonly totalTicks: number;
  /** Current RSS in bytes; absent when `VmRSS` was not readable. */
  readonly rssBytes?: number;
}

/**
 * Pure `/proc` parsing, split from the I/O so every branch is unit
 * testable without a live process.
 *
 * A LOCAL sampler rather than `@eo/perf`'s `trySampleProcess`: roadmap/15:32
 * scopes that sampler to "the benchmarked base/candidate processes only
 * (not the supervisor's own idle budget)", so importing it here would
 * re-create in the measurement layer exactly the coupling the decision
 * layer was just freed from. It is ~30 lines; the dependency is not worth
 * the ambiguity.
 *
 * `/proc/<pid>/stat`'s field 2 (`comm`) is parenthesized and may itself
 * contain spaces or parens, so this splits on the LAST `)`; `utime`/`stime`
 * are 1-indexed fields 14/15, i.e. offsets 11/12 after it.
 */
export function parseIdleProcSample(
  statContent: string | undefined,
  statusContent: string | undefined,
): IdleProcSample | undefined {
  if (statContent === undefined) return undefined;

  const fields = statContent
    .slice(statContent.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  const utimeTicks = Number(fields[14 - 3]);
  const stimeTicks = Number(fields[15 - 3]);
  if (!Number.isFinite(utimeTicks) || !Number.isFinite(stimeTicks)) return undefined;

  const rssKb = statusContent === undefined ? undefined : parseVmRssKb(statusContent);
  return {
    totalTicks: utimeTicks + stimeTicks,
    ...(rssKb === undefined ? {} : { rssBytes: rssKb * 1024 }),
  };
}

/**
 * CURRENT RSS (`VmRSS`), never `VmHWM`. The high-water mark is cumulative
 * since process start, so it would carry the startup peak into every idle
 * sample and defeat the warmup exclusion above; falling back to it would
 * silently turn "peak RSS while idle" into "peak RSS while booting". A poll
 * with no `VmRSS` simply contributes no RSS sample, and fewer than
 * `SUPERVISOR_IDLE_MIN_SAMPLES` RSS samples is `inconclusive_blocking` —
 * see `decideReleaseContracts`, which applies exactly that floor.
 */
function parseVmRssKb(statusContent: string): number | undefined {
  const match = /^VmRSS:\s*(\d+)\s*kB\s*$/m.exec(statusContent);
  if (match === null) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

async function readProcFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // The process exited, or this host has no `/proc`. Both are "no sample
    // this poll", which the caller treats as a reported condition rather
    // than an exception.
    return undefined;
  }
}

/** Best-effort `/proc` sample of one pid; `undefined` once the process is gone. */
export async function sampleIdleProcess(pid: number): Promise<IdleProcSample | undefined> {
  const [statContent, statusContent] = await Promise.all([
    readProcFile(`/proc/${String(pid)}/stat`),
    readProcFile(`/proc/${String(pid)}/status`),
  ]);
  return parseIdleProcSample(statContent, statusContent);
}

/** The built daemon entry point; absent until `npm run build` has run. */
export function supervisordEntryPoint(repoRoot: string): string {
  return join(repoRoot, "packages", "cli", "dist", "bin", "supervisord.js");
}

/**
 * How long teardown waits for the daemon to honour SIGTERM before
 * escalating. Generous relative to the daemon's own shutdown path — the
 * point of the bound is that a supervisor which ignores SIGTERM cannot hang
 * the release run, not that a slow one is killed.
 */
export const SUPERVISOR_TEARDOWN_GRACE_MS = 5_000;

/**
 * Ends a booted daemon and WAITS FOR IT TO BE GONE.
 *
 * A bare `child.kill("SIGTERM")` returns the moment the signal is queued,
 * so the probe could resolve — and the test asserting on it pass — with the
 * supervisor still running. That is not theoretical: it leaked an orphaned
 * `supervisord.js` on this host, which had to be killed by hand.
 *
 * SIGKILL escalation is deliberately AFTER the grace period AND reported,
 * never silent. A teardown that escalated is still a teardown, but it means
 * the daemon ignored the signal it is supposed to shut down on, and the
 * caller's evidence should be able to say so.
 */
export async function terminateDaemon(
  child: ChildProcess,
  graceMs: number = SUPERVISOR_TEARDOWN_GRACE_MS,
): Promise<SupervisorTeardown | undefined> {
  const pid = child.pid;
  // A process that never spawned emits `error`, never `exit`; there is
  // nothing to signal and nothing to wait for.
  if (pid === undefined) return undefined;
  if (child.exitCode !== null || child.signalCode !== null) {
    return { pid, escalatedToSigkill: false };
  }

  // Subscribed BEFORE the signal, so an immediate exit cannot be missed.
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });

  child.kill("SIGTERM");
  if (await settledWithin(exited, graceMs)) return { pid, escalatedToSigkill: false };

  child.kill("SIGKILL");
  await exited;
  return { pid, escalatedToSigkill: true };
}

/** `true` if `promise` settled inside `ms`. The timer is always cleared, so it never holds the loop open. */
async function settledWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const EMPTY_SAMPLES = {
  rssSamplesBytes: [] as readonly number[],
  cpuTicksConsumed: 0,
  observedSpanMs: 0,
  sampleCount: 0,
} as const;

/** What one idle sampling run observed, before the quiet-host assessment is attached. */
export type IdleSampleCollection = Omit<SupervisorIdleMeasurement, "quietHost">;

export interface CollectIdleSamplesOptions {
  /** The already-running daemon to sample. */
  readonly pid: number;
  /** How long to keep sampling after the warmup, in milliseconds. */
  readonly windowMs: number;
  /** Startup time excluded from the measurement; see `STARTUP_WARMUP_MS`. */
  readonly warmupMs?: number;
  /**
   * The `/proc` sampler. Injected ONLY so the failure paths below — daemon
   * gone before the window opened, daemon gone mid-window, window closed
   * before any poll landed — are reachable from a unit test without booting
   * and killing three more supervisors. Production never passes it, and the
   * default is the same sampler the real probe uses.
   */
  readonly sample?: (pid: number) => Promise<IdleProcSample | undefined>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Samples one running pid across the idle window.
 *
 * Every exit from here that is not a full window of samples pushes a
 * `failures` entry, and `undecidableReason` turns any failure into
 * `inconclusive_blocking` for every contract. There is deliberately no path
 * on which a truncated or empty measurement is scored.
 */
export async function collectIdleSamples({
  pid,
  windowMs,
  warmupMs = STARTUP_WARMUP_MS,
  sample = sampleIdleProcess,
}: CollectIdleSamplesOptions): Promise<IdleSampleCollection> {
  const rssSamplesBytes: number[] = [];
  const failures: string[] = [];
  let cpuTicksConsumed = 0;
  let observedSpanMs = 0;
  let sampleCount = 0;

  // Let the daemon finish booting before anything is recorded.
  await delay(warmupMs);
  const first = await sample(pid);
  if (first === undefined) {
    failures.push("supervisor daemon exited during startup, before the idle window opened.");
  } else {
    const startTicks = first.totalTicks;
    const startedAt = Date.now();
    const deadline = startedAt + windowMs;

    while (Date.now() < deadline) {
      await delay(SAMPLE_INTERVAL_MS);
      const current = await sample(pid);
      if (current === undefined) {
        failures.push("supervisor daemon exited during the idle measurement window.");
        break;
      }

      sampleCount += 1;
      if (current.rssBytes !== undefined) rssSamplesBytes.push(current.rssBytes);
      // Re-stated on every poll rather than after the loop, so a loop that
      // breaks on daemon exit still reports exactly the tick delta and wall
      // span it actually observed — never the window it asked for.
      cpuTicksConsumed = current.totalTicks - startTicks;
      observedSpanMs = Date.now() - startedAt;
    }
  }

  if (sampleCount === 0 && failures.length === 0) {
    failures.push("no samples were collected from the supervisor daemon.");
  }

  return { rssSamplesBytes, cpuTicksConsumed, observedSpanMs, sampleCount, failures };
}

/**
 * Boots the real supervisor daemon under a disposable XDG root, lets it sit
 * idle across several heartbeat intervals, and samples `/proc` throughout.
 *
 * Always tears the daemon down, including on failure, and does not resolve
 * until it is actually gone — see `terminateDaemon`. The teardown it
 * performed is returned as `teardown`, so a caller can assert on it.
 */
export async function measureSupervisorIdle(
  repoRoot: string,
  windowMs: number = SUPERVISOR_IDLE_WINDOW_MS,
): Promise<SupervisorIdleMeasurement> {
  const entry = supervisordEntryPoint(repoRoot);
  const quiet = await probeQuietHost();

  if (!existsSync(entry)) {
    return {
      ...EMPTY_SAMPLES,
      quietHost: await quiet.finish(),
      failures: [`supervisor daemon is not built (${entry} does not exist) — run npm run build.`],
    };
  }

  // Deliberately terse paths. The daemon's control socket lives at
  // `$XDG_STATE_HOME/engineering-orchestrator/<hash>/supervisor/run/control.sock`,
  // and a Unix domain socket path is capped at 108 bytes (`sun_path`).
  // A conventional `mkdtemp(tmpdir(), "eo-perf-release-")` root plus a
  // 32-character project hash overruns that and the daemon dies with
  // `listen EINVAL` before it can be sampled at all — observed while
  // building this probe.
  const xdgRoot = await mkdtemp(join(tmpdir(), "eo-p"));
  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      XDG_STATE_HOME: join(xdgRoot, "s"),
      XDG_CACHE_HOME: join(xdgRoot, "c"),
      XDG_RUNTIME_DIR: join(xdgRoot, "r"),
      EO_PROJECT_HASH: "perfrel00",
    },
  });

  let collected: IdleSampleCollection = {
    ...EMPTY_SAMPLES,
    failures: ["supervisor daemon could not be spawned."],
  };

  let teardown: SupervisorTeardown | undefined;
  try {
    const pid = child.pid;
    if (pid !== undefined) collected = await collectIdleSamples({ pid, windowMs });
  } finally {
    teardown = await terminateDaemon(child);
    await rm(xdgRoot, { recursive: true, force: true });
  }

  return {
    ...collected,
    quietHost: await quiet.finish(),
    ...(teardown === undefined ? {} : { teardown }),
  };
}

export interface ReleaseContractDecision {
  readonly contractId: string;
  readonly metric: PerformanceMetric;
  readonly absoluteBudget: number;
  /** 02's canonical `PERFORMANCE_OUTCOMES` member, derived locally. */
  readonly outcome: PerformanceOutcome;
  /** Names the single statistic `observed` is, so the report cannot describe a different one. */
  readonly statistic: string;
  /** The value the outcome was decided on; absent iff `inconclusive_blocking`. */
  readonly observed?: number;
  readonly sampleCount: number;
  readonly observedSpanMs: number;
  readonly note?: string;
}

/**
 * The statistic each budget is decided on, named so the report can quote it
 * verbatim. The tick rate is INTERPOLATED from the constant the arithmetic
 * divides by, never re-typed: a re-pinned `CLOCK_TICKS_PER_SECOND` must not
 * be able to leave the emitted evidence naming a divisor the code did not
 * use.
 */
function statisticLabel(metric: PerformanceMetric): string {
  return metric === "peak_rss"
    ? "max sampled current RSS across a single boot"
    : "idle CPU over the observed span (total ticks / " +
        `(${String(CLOCK_TICKS_PER_SECOND)} Hz * elapsed wall seconds))`;
}

/**
 * RSS carries its raw byte count alongside the rounded MiB. Rounding alone
 * makes a marginal breach unreadable: at 100.04 MiB the line would render
 * "budget 100.0 MiB, ... 100.0 MiB" next to a `block`, i.e. two identical
 * numbers and a verdict the line cannot explain. The exact bytes always can.
 */
function formatMetricValue(metric: PerformanceMetric, value: number): string {
  return metric === "peak_rss"
    ? `${(value / (1024 * 1024)).toFixed(2)} MiB (${String(value)} bytes)`
    : `${(value * 100).toFixed(3)}% of one core`;
}

/**
 * Why a measurement cannot decide ANY contract, or `undefined` if it can.
 * Ordered most-fundamental first so the note names the root condition
 * rather than one of its consequences.
 */
function undecidableReason(measurement: SupervisorIdleMeasurement): string | undefined {
  if (measurement.failures.length > 0) {
    return `the measurement did not complete: ${measurement.failures.join(" ")}`;
  }
  if (!measurement.quietHost.quiet) {
    return `host was not quiet: ${measurement.quietHost.reasons.join(" ")}`;
  }
  if (measurement.sampleCount < SUPERVISOR_IDLE_MIN_SAMPLES) {
    return (
      `only ${String(measurement.sampleCount)} sample(s) were collected, below the ` +
      `${String(SUPERVISOR_IDLE_MIN_SAMPLES)}-sample floor for a sustained idle window.`
    );
  }
  if (measurement.observedSpanMs < SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS) {
    return (
      `the observed idle span was ${String(measurement.observedSpanMs)} ms, shorter than the ` +
      `${String(SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS)} ms heartbeat interval it must cover.`
    );
  }
  return undefined;
}

/**
 * Compares each measured statistic against 05's absolute budget. No
 * statistical machinery and no `packages/perf` (roadmap/15:38, roadmap/05:38).
 *
 * A contract that cannot be decided — contended host, failed measurement,
 * too few polls, too short a span, or no samples for that metric — is
 * `inconclusive_blocking`. Never silently dropped, and never a pass.
 */
export function decideReleaseContracts(
  measurement: SupervisorIdleMeasurement,
  budgets: readonly ReleasePerformanceBudget[] = RELEASE_PERFORMANCE_BUDGETS,
): readonly ReleaseContractDecision[] {
  const undecidable = undecidableReason(measurement);
  const elapsedSeconds = measurement.observedSpanMs / 1000;

  return budgets.map((budget) => {
    const base = {
      contractId: budget.contractId,
      metric: budget.metric,
      absoluteBudget: budget.absoluteBudget,
      statistic: statisticLabel(budget.metric),
      sampleCount: measurement.sampleCount,
      observedSpanMs: measurement.observedSpanMs,
    } as const;

    if (undecidable !== undefined) {
      return { ...base, outcome: "inconclusive_blocking", note: undecidable };
    }

    let observed: number;
    if (budget.metric === "peak_rss") {
      // The SAME floor the poll count is held to, applied to the RSS series
      // in its own right: `/proc/<pid>/stat` can stay readable while
      // `/proc/<pid>/status` does not report `VmRSS`, and one reading out of
      // sixty-four is a single observation, not a ceiling.
      if (measurement.rssSamplesBytes.length < SUPERVISOR_IDLE_MIN_SAMPLES) {
        return {
          ...base,
          outcome: "inconclusive_blocking",
          note:
            `only ${String(measurement.rssSamplesBytes.length)} RSS sample(s) were collected ` +
            `from /proc/<pid>/status (VmRSS), below the ${String(SUPERVISOR_IDLE_MIN_SAMPLES)}-` +
            "sample floor a ceiling must be read from.",
        };
      }
      observed = Math.max(...measurement.rssSamplesBytes);
    } else {
      // The budget's own definition: average fraction of one core across
      // the window actually observed. `elapsedSeconds` is non-zero here —
      // `undecidableReason` already enforced the span floor.
      observed = measurement.cpuTicksConsumed / (CLOCK_TICKS_PER_SECOND * elapsedSeconds);
    }

    // 05 states both budgets strictly ("<100 MiB", "<1% core"), so a
    // statistic sitting exactly ON the budget has not met it.
    return { ...base, outcome: observed < budget.absoluteBudget ? "pass" : "block", observed };
  });
}

/**
 * Where roadmap/23:75's OTHER obligation is looked for.
 *
 * 23:75 asks 15's `PerformanceContract` decision engine and twin-worktree
 * A/B runner to be "re-run on a quiet host for the release-candidate's real
 * verdicts". That run is not this module's to perform — it is 15's harness
 * against the frozen candidate — so this check consumes its RECORD, exactly
 * as `arm64Verification.ts` consumes a CI run record rather than claiming to
 * have run an ARM64 build itself.
 *
 * NO SUCH RECORD EXISTS IN THIS REPOSITORY, and nothing here writes one.
 * The path is declared so the block below is a locator a reader can act on
 * rather than an unfalsifiable statement, and so the item clears when the
 * re-run produces evidence instead of when someone edits this file.
 */
export const PERFORMANCE_RERUN_RECORD_PATH = "docs/evidence/phase-23/perf-contract-rerun.json";
/** Override, for a CI leg that produces the record out-of-tree. */
export const PERFORMANCE_RERUN_RECORD_ENV = "EO_PERF_CONTRACT_RERUN_RECORD";

/**
 * The minimum a 23:75 record must state to be the thing 23:75 asked for:
 * which candidate was measured, by what, whether the host was quiet, and
 * the verdicts themselves. `.strict()` so a record carrying fields this
 * check does not understand is reported rather than silently half-read.
 */
export const PerformanceRerunRecordSchema = z
  .object({
    /** The frozen release-candidate object ID the re-run was executed against. */
    releaseCandidateObjectId: z.string().min(1),
    /**
     * What produced it — provenance, not a label.
     *
     * An earlier revision of this line read "15's twin-worktree A/B runner,
     * never a fixture harness". That was written before the producer
     * existed and overshot the roadmap: `roadmap/15:112` settles the entry
     * point in as many words — "`perf-conformance` runs as a standalone,
     * named CI job invocable without the full release harness — the exact
     * entry point 23 re-runs" — and `roadmap/23:26` asks for "seeded-fault
     * matrices from 14/15/22 executed on the frozen release-candidate
     * object ID". `perf-conformance` drives 15's real
     * `runTwinWorktreeBenchmark` and its real `decide()` engine; the
     * fixtures are the seeded faults the criterion asks for, not a
     * substitute for the runner. See `./perfContractRerun.ts`.
     */
    runner: z.string().min(1),
    /** 23:75: "on a quiet host". */
    quietHost: z.boolean(),
    capturedAt: z.string().min(1),
    /** 15's real verdicts. An empty set is not a re-run. */
    contracts: z
      .array(
        z
          .object({
            contractId: z.string().min(1),
            outcome: z.enum(PERFORMANCE_OUTCOMES),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type PerformanceRerunRecord = z.infer<typeof PerformanceRerunRecordSchema>;

/**
 * A record, or a stated reason there is none. Deliberately a union rather
 * than two optional fields: "no record and no explanation why" must not be
 * representable.
 */
export type PerformanceRerunEvidence =
  | {
      readonly releaseCandidateObjectId: string;
      readonly record: PerformanceRerunRecord;
      readonly unavailable?: undefined;
    }
  | {
      readonly releaseCandidateObjectId: string;
      readonly record?: undefined;
      readonly unavailable: string;
    };

/**
 * Reads the 23:75 record if there is one. Never throws: a malformed record
 * is a finding this check reports, not an exception that aborts the release
 * run and leaves the item showing "no evidence".
 */
export function readPerformanceRerunEvidence(
  repoRoot: string,
  releaseCandidateObjectId: string,
): PerformanceRerunEvidence {
  const override = process.env[PERFORMANCE_RERUN_RECORD_ENV];
  const path =
    override === undefined || override.trim() === ""
      ? join(repoRoot, PERFORMANCE_RERUN_RECORD_PATH)
      : override;

  if (!existsSync(path)) {
    return {
      releaseCandidateObjectId,
      unavailable:
        `no record at ${PERFORMANCE_RERUN_RECORD_PATH} (looked at ${path}; ` +
        `$${PERFORMANCE_RERUN_RECORD_ENV} overrides).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      releaseCandidateObjectId,
      unavailable: `${path} could not be read as JSON: ${(error as Error).message}`,
    };
  }

  const result = PerformanceRerunRecordSchema.safeParse(parsed);
  if (!result.success) {
    return {
      releaseCandidateObjectId,
      unavailable:
        `${path} does not match the 15 re-run record schema: ` +
        result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    };
  }
  return { releaseCandidateObjectId, record: result.data };
}

export interface CheckPerformanceContractsInput {
  readonly decisions: readonly ReleaseContractDecision[];
  readonly quietHost: QuietHostAssessment;
  readonly failures: readonly string[];
  /** roadmap/23:75's separate obligation, read rather than assumed. */
  readonly rerunEvidence: PerformanceRerunEvidence;
}

/**
 * What this evidence measures and what it reads.
 *
 * roadmap/23 carries TWO performance obligations against ONE checklist
 * item: 05's supervisor idle-budget re-measurement on a quiet host (23:27,
 * and 23:65's carry-forward row), and 15's own re-run — the
 * `PerformanceContract` decision engine and twin-worktree A/B runner —
 * "on a quiet host for the release-candidate's real verdicts" (23:75).
 * This module measures the first and consumes a record of the second, and
 * `RELEASE_GATE_CHECKLIST`'s single `performance-contracts` item cites 15
 * (`e2e/report/src/checklist.ts` — "Performance contracts satisfied rather
 * than skipped, measured on a quiet host (15)").
 */
const SCOPE_DETAIL =
  "scope: this check MEASURES roadmap/23's 05 supervisor idle-budget re-measurement (23:27, " +
  "23:65) and READS a record of 15's separate PerformanceContract/twin-worktree re-run for the " +
  `release candidate (23:75) from ${PERFORMANCE_RERUN_RECORD_PATH} ` +
  `($${PERFORMANCE_RERUN_RECORD_ENV} overrides). Both are booked against this one checklist item.`;

/**
 * ...and while that record is absent, this item cannot report PASS.
 *
 * A detail line does not move a verdict. A consumer of
 * `e2e/release-gate-report.json` reads PASS/FAIL, so a green item with a
 * caveat buried in its details would assert coverage of both obligations
 * while evidencing one — the precise failure mode roadmap/README.md ground
 * rule 3 ("exit criteria are evidence, not claims") exists to prevent. The
 * scope gap is therefore emitted as a blocking REASON.
 *
 * It is a CONDITION, not a constant. The only 15 entry point that runs
 * today is `.github/workflows/perf-conformance.yml`, which states in its own
 * header that it is "Entirely fixture-based (no live twin-worktree runs, no
 * real ProjectProfile benchmark commands)" — fixtures, not the release
 * candidate's real verdicts — so the reason is emitted on every run of this
 * repository as it stands. But it is emitted BECAUSE
 * `readPerformanceRerunEvidence` found no record, and it stops being
 * emitted when a real one appears. A hardcoded reason would instead leave
 * this item's verdict carrying no signal about the idle budget at all: an
 * idle-RSS regression to 500 MiB would add a reason to an item that was
 * already permanently FAIL, and nothing a reader watches would move.
 *
 * The alternative shape — collapsing the idle contracts themselves into
 * `inconclusive_blocking` — was rejected: it would erase the 23:27/23:65
 * re-measurement this check DID perform (an `inconclusive_blocking`
 * decision carries no `observed` value), destroying evidence to express a
 * gap that has nothing to do with the measurement.
 */
export const PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON =
  "roadmap/23:75's 15 PerformanceContract/twin-worktree re-run for the release candidate is " +
  "UNEVIDENCED. This checklist item cites 15, and this check measures only the OTHER " +
  "obligation booked against it — 05's supervisor idle-budget re-measurement (roadmap/23:27, " +
  "23:65). The sole 15 entry point that runs today, .github/workflows/perf-conformance.yml, is " +
  "fixture-based by its own statement and produces no release-candidate verdicts.";

/**
 * The 23:75 half of this criterion, scored on its record. Split out so each
 * way a record can fail to be the thing 23:75 asked for is one branch with
 * one reason, rather than a single "record looked wrong" verdict a reader
 * cannot act on.
 */
function checkRerunEvidence(evidence: PerformanceRerunEvidence): {
  readonly reasons: readonly string[];
  readonly details: readonly string[];
} {
  if (evidence.record === undefined) {
    return {
      reasons: [`${PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON} ${evidence.unavailable}`],
      details: [`15 re-run record: none. ${evidence.unavailable}`],
    };
  }

  const record = evidence.record;
  const reasons: string[] = [];
  const details: string[] = [
    `15 re-run record: runner "${record.runner}", object ${record.releaseCandidateObjectId}, ` +
      `quiet host ${String(record.quietHost)}, captured ${record.capturedAt}, ` +
      `${String(record.contracts.length)} contract(s).`,
  ];

  if (record.releaseCandidateObjectId !== evidence.releaseCandidateObjectId) {
    reasons.push(
      `the 15 re-run record was taken against ${record.releaseCandidateObjectId}, not the release ` +
        `candidate ${evidence.releaseCandidateObjectId}. roadmap/23:75 asks for "the ` +
        "release-candidate's real verdicts\", which a run of a different tree is not.",
    );
  }
  if (!record.quietHost) {
    reasons.push(
      "the 15 re-run record states it was NOT taken on a quiet host, which is what roadmap/23:75 " +
        "asks for — a contended benchmark decides nothing.",
    );
  }
  const unsatisfied = record.contracts.filter((contract) => contract.outcome !== "pass");
  if (unsatisfied.length > 0) {
    reasons.push(
      "the 15 re-run did not satisfy every PerformanceContract: " +
        unsatisfied.map((contract) => `${contract.contractId} -> ${contract.outcome}`).join(", ") +
        ". This exit criterion requires contracts be satisfied rather than skipped.",
    );
  }
  return { reasons, details };
}

/**
 * Pure verdict — an empty contract set is a FAIL, never a vacuous "all
 * satisfied", and 23:75's separate obligation blocks until its record says
 * otherwise.
 */
export function checkPerformanceContracts(
  input: CheckPerformanceContractsInput,
): AttestationCheckResult {
  const rerun = checkRerunEvidence(input.rerunEvidence);
  const reasons: string[] = [...rerun.reasons];
  const details: string[] = [
    SCOPE_DETAIL,
    ...rerun.details,
    `quiet host: ${String(input.quietHost.quiet)} ` +
      `(load/core ${input.quietHost.loadPerCore.toFixed(2)}, ` +
      `idle ${(input.quietHost.idleFraction * 100).toFixed(1)}%)`,
  ];

  for (const failure of input.failures) reasons.push(`measurement failed: ${failure}`);

  if (input.decisions.length === 0) {
    reasons.push(
      "no performance contracts were measured for the release candidate — an empty set is never " +
        'scored as "all contracts satisfied".',
    );
    return buildCheckResult(reasons, details);
  }

  for (const decision of input.decisions) {
    // The detail line renders the SAME statistic the outcome was decided
    // on, by name. An earlier revision rendered `observed max` of the raw
    // sample array while deciding on something else entirely, which made
    // the report a false account of its own verdict.
    const observedText =
      decision.observed === undefined
        ? "not decided"
        : formatMetricValue(decision.metric, decision.observed);
    details.push(
      `${decision.contractId} (${decision.metric}): ${decision.outcome}, ` +
        `budget ${formatMetricValue(decision.metric, decision.absoluteBudget)}, ` +
        `${decision.statistic} ${observedText}, ` +
        `${String(decision.sampleCount)} sample(s) over ${String(decision.observedSpanMs)} ms.`,
    );

    if (decision.outcome === "inconclusive_blocking") {
      reasons.push(
        `${decision.contractId}: INCONCLUSIVE — the contract was not decided` +
          `${decision.note === undefined ? "" : ` (${decision.note})`}. This exit criterion ` +
          "requires contracts be satisfied rather than skipped.",
      );
    } else if (decision.outcome !== "pass") {
      reasons.push(
        `${decision.contractId}: ${decision.outcome.toUpperCase()} — ${decision.statistic} was ` +
          `${observedText}, against budget ` +
          `${formatMetricValue(decision.metric, decision.absoluteBudget)}.`,
      );
    }
  }

  return buildCheckResult(reasons, details);
}

/** Runs the whole release perf measurement against a real repository checkout. */
export async function runPerformanceContracts(
  repoRoot: string,
  releaseCandidateObjectId: string,
): Promise<CheckPerformanceContractsInput> {
  const measurement = await measureSupervisorIdle(repoRoot);
  return {
    decisions: decideReleaseContracts(measurement),
    quietHost: measurement.quietHost,
    failures: measurement.failures,
    rerunEvidence: readPerformanceRerunEvidence(repoRoot, releaseCandidateObjectId),
  };
}

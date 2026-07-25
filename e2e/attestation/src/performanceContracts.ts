import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PerformanceMetric } from "@eo/contracts";
import { decide, trySampleProcess } from "@eo/perf";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";
import { probeQuietHost, type QuietHostAssessment } from "./quietHost.js";

/**
 * `performance-contracts` — roadmap/23 Exit criteria: "Performance
 * contracts satisfied rather than skipped, measured on a quiet host (15)",
 * and §In scope: "Supervisor idle-budget re-measurement (05's <100 MiB RSS
 * / <1% core / 5 s heartbeat numbers) on a quiet host, per 05's and 15's
 * own deferred notes."
 *
 * WHAT CHANGED, AND WHY (2026-07-25): the first version of this check read
 * a hand-written JSON file and invented its own
 * `satisfied | regressed | skipped` vocabulary. Both were wrong. The
 * canonical outcome set is 15's own `PERFORMANCE_OUTCOMES`
 * (`pass | block | inconclusive_blocking`), in which
 * `inconclusive_blocking` already IS the "skipped" concept and already
 * blocks; and reading a file somebody wrote by hand is not a measurement.
 * This module now MEASURES, on the real release candidate, and routes the
 * samples through 15's actual decision engine (`decide`).
 *
 * WHY ABSOLUTE BUDGETS RATHER THAN A TWIN-WORKTREE A/B: 15's twin-worktree
 * runner exists to catch a REGRESSION between a base and a candidate
 * revision — the right tool for gating a change set. The release
 * obligation is different and is stated in absolute terms: 05 fixes the
 * idle budget at <100 MiB RSS and <1% of a core. `decide` checks an
 * absolute budget before any statistical reasoning ("Absolute-budget breach
 * blocks, checked BEFORE any statistical reasoning, unconditionally"), so
 * the same engine serves both. Base and candidate samples are deliberately
 * the same series here: there is no second revision in an absolute-budget
 * contract, and passing one makes the regression term identically zero so
 * the absolute rule decides, which is exactly the intent.
 *
 * A NOISY HOST NEVER YIELDS A PASS. If the quiet-host probe reports the
 * measurement window was contended, every contract is reported
 * `inconclusive_blocking` regardless of the numbers observed — an
 * undecidable contract is what "satisfied rather than skipped" forbids.
 */

/** 05 §Idle resource budget: "<100 MiB RSS". */
export const SUPERVISOR_IDLE_RSS_BUDGET_BYTES = 100 * 1024 * 1024;
/** 05 §Idle resource budget: "<1% core". */
export const SUPERVISOR_IDLE_CPU_FRACTION_BUDGET = 0.01;
/** 05 §Idle resource budget: "5 s heartbeats" — the idle window must span at least one. */
export const SUPERVISOR_IDLE_WINDOW_MS = 6_000;

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

export interface SupervisorIdleMeasurement {
  /** Peak RSS observed while the daemon sat idle, in bytes. */
  readonly peakRssBytes: readonly number[];
  /** Fraction of one core consumed while idle. */
  readonly cpuFraction: readonly number[];
  readonly quietHost: QuietHostAssessment;
  /** Non-empty when the daemon could not be measured at all. */
  readonly failures: readonly string[];
}

const CLOCK_TICKS_PER_SECOND = 100;
/** Poll cadence. Chosen so the idle window yields well above 15's 10-sample methodology floor. */
const SAMPLE_INTERVAL_MS = 250;
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
 */
const STARTUP_WARMUP_MS = 2_500;

/** The built daemon entry point; absent until `npm run build` has run. */
export function supervisordEntryPoint(repoRoot: string): string {
  return join(repoRoot, "packages", "cli", "dist", "bin", "supervisord.js");
}

/**
 * Boots the real supervisor daemon under a disposable XDG root, lets it sit
 * idle for at least one heartbeat interval, and samples `/proc` throughout.
 * Always tears the daemon down, including on failure.
 */
export async function measureSupervisorIdle(
  repoRoot: string,
  windowMs: number = SUPERVISOR_IDLE_WINDOW_MS,
): Promise<SupervisorIdleMeasurement> {
  const entry = supervisordEntryPoint(repoRoot);
  const quiet = await probeQuietHost();

  if (!existsSync(entry)) {
    return {
      peakRssBytes: [],
      cpuFraction: [],
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

  const peakRssBytes: number[] = [];
  const cpuFraction: number[] = [];
  const failures: string[] = [];

  try {
    const pid = child.pid;
    if (pid === undefined) {
      failures.push("supervisor daemon could not be spawned.");
    } else {
      // Let the daemon finish booting before anything is recorded.
      await new Promise((resolve) => setTimeout(resolve, STARTUP_WARMUP_MS));
      const first = await trySampleProcess(pid);
      if (first === undefined) {
        failures.push("supervisor daemon exited during startup, before the idle window opened.");
      } else {
        // One sample PER POLL INTERVAL, not one aggregate over the window.
        // 15's `assertMethodologySound` enforces MIN_INTERLEAVED_REPETITIONS
        // (10) samples per side and refuses outright below it — a single
        // whole-window average is not a sample series, and the decision
        // engine is right to reject it. At `SAMPLE_INTERVAL_MS` over
        // `SUPERVISOR_IDLE_WINDOW_MS` this yields comfortably more than the
        // floor for both metrics.
        let previousTicks = first.stat.utimeTicks + first.stat.stimeTicks;
        let previousAt = Date.now();
        const startedAt = previousAt;
        const deadline = startedAt + windowMs;

        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
          const sample = await trySampleProcess(pid);
          if (sample === undefined) {
            failures.push("supervisor daemon exited during the idle measurement window.");
            break;
          }

          // CURRENT RSS, not `VmHWM`. The high-water mark is cumulative
          // since process start, so it would carry the startup peak into
          // every idle sample and defeat the warmup exclusion above. The
          // maximum across the idle window is then the genuine "peak RSS
          // while idle" this budget is about.
          const rssKb = sample.status.vmRssKb ?? sample.status.vmHwmKb;
          if (rssKb !== undefined) peakRssBytes.push(rssKb * 1024);

          const now = Date.now();
          const ticks = sample.stat.utimeTicks + sample.stat.stimeTicks;
          const elapsedSeconds = (now - previousAt) / 1000;
          if (elapsedSeconds > 0) {
            cpuFraction.push((ticks - previousTicks) / CLOCK_TICKS_PER_SECOND / elapsedSeconds);
          }
          previousTicks = ticks;
          previousAt = now;
        }
      }
    }
  } finally {
    child.kill("SIGTERM");
    await rm(xdgRoot, { recursive: true, force: true });
  }

  if (peakRssBytes.length === 0 && failures.length === 0) {
    failures.push("no RSS samples were collected from the supervisor daemon.");
  }

  return { peakRssBytes, cpuFraction, quietHost: await quiet.finish(), failures };
}

export interface ReleaseContractDecision {
  readonly contractId: string;
  readonly metric: PerformanceMetric;
  readonly absoluteBudget: number;
  /** 15's canonical `PERFORMANCE_OUTCOMES` member. */
  readonly outcome: string;
  readonly samples: readonly number[];
  readonly note?: string;
}

/**
 * Routes each measured series through 15's real decision engine. A contract
 * with no samples, or one measured on a contended host, is
 * `inconclusive_blocking` — never silently dropped and never a pass.
 */
export function decideReleaseContracts(
  measurement: SupervisorIdleMeasurement,
  budgets: readonly ReleasePerformanceBudget[] = RELEASE_PERFORMANCE_BUDGETS,
): readonly ReleaseContractDecision[] {
  return budgets.map((budget) => {
    const samples =
      budget.metric === "peak_rss" ? measurement.peakRssBytes : measurement.cpuFraction;

    if (samples.length === 0) {
      return {
        contractId: budget.contractId,
        metric: budget.metric,
        absoluteBudget: budget.absoluteBudget,
        outcome: "inconclusive_blocking",
        samples,
        note: "no samples were collected — the contract could not be decided.",
      };
    }
    if (!measurement.quietHost.quiet) {
      return {
        contractId: budget.contractId,
        metric: budget.metric,
        absoluteBudget: budget.absoluteBudget,
        outcome: "inconclusive_blocking",
        samples,
        note: `host was not quiet: ${measurement.quietHost.reasons.join(" ")}`,
      };
    }

    const result = decide({
      metric: budget.metric,
      baseSamples: samples,
      candidateSamples: samples,
      pathSensitivity: "critical",
      absoluteBudget: budget.absoluteBudget,
    });

    return {
      contractId: budget.contractId,
      metric: budget.metric,
      absoluteBudget: budget.absoluteBudget,
      outcome: result.outcome,
      samples,
    };
  });
}

export interface CheckPerformanceContractsInput {
  readonly decisions: readonly ReleaseContractDecision[];
  readonly quietHost: QuietHostAssessment;
  readonly failures: readonly string[];
}

/** Pure verdict — an empty contract set is a FAIL, never a vacuous "all satisfied". */
export function checkPerformanceContracts(
  input: CheckPerformanceContractsInput,
): AttestationCheckResult {
  const reasons: string[] = [];
  const details: string[] = [
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
    const observed = decision.samples.length > 0 ? Math.max(...decision.samples) : undefined;
    details.push(
      `${decision.contractId} (${decision.metric}): ${decision.outcome}, ` +
        `budget ${decision.absoluteBudget}, observed max ` +
        `${observed === undefined ? "n/a" : observed.toFixed(4)}, ${decision.samples.length} sample(s).`,
    );

    if (decision.outcome === "inconclusive_blocking") {
      reasons.push(
        `${decision.contractId}: INCONCLUSIVE — the contract was not decided` +
          `${decision.note === undefined ? "" : ` (${decision.note})`}. This exit criterion ` +
          "requires contracts be satisfied rather than skipped.",
      );
    } else if (decision.outcome !== "pass") {
      reasons.push(
        `${decision.contractId}: ${decision.outcome.toUpperCase()} — measured ` +
          `${observed === undefined ? "n/a" : String(observed)} against budget ${decision.absoluteBudget}.`,
      );
    }
  }

  return buildCheckResult(reasons, details);
}

/** Runs the whole release perf measurement against a real repository checkout. */
export async function runPerformanceContracts(
  repoRoot: string,
): Promise<CheckPerformanceContractsInput> {
  const measurement = await measureSupervisorIdle(repoRoot);
  return {
    decisions: decideReleaseContracts(measurement),
    quietHost: measurement.quietHost,
    failures: measurement.failures,
  };
}

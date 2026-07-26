import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLOCK_TICKS_PER_SECOND,
  PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON,
  PERFORMANCE_RERUN_RECORD_ENV,
  PERFORMANCE_RERUN_RECORD_PATH,
  RELEASE_PERFORMANCE_BUDGETS,
  SAMPLE_INTERVAL_MS,
  STARTUP_WARMUP_MS,
  SUPERVISOR_IDLE_CPU_FRACTION_BUDGET,
  SUPERVISOR_IDLE_HEARTBEAT_MS,
  SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS,
  SUPERVISOR_IDLE_MIN_SAMPLES,
  SUPERVISOR_IDLE_RSS_BUDGET_BYTES,
  SUPERVISOR_IDLE_WINDOW_MS,
  checkPerformanceContracts,
  collectIdleSamples,
  decideReleaseContracts,
  measureSupervisorIdle,
  parseIdleProcSample,
  readPerformanceRerunEvidence,
  sampleIdleProcess,
  supervisordEntryPoint,
  terminateDaemon,
  type IdleProcSample,
  type PerformanceRerunEvidence,
  type SupervisorIdleMeasurement,
} from "./performanceContracts.js";
import type { QuietHostAssessment } from "./quietHost.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const QUIET: QuietHostAssessment = {
  quiet: true,
  loadPerCore: 0.02,
  idleFraction: 0.98,
  reasons: [],
};
const NOISY: QuietHostAssessment = {
  quiet: false,
  loadPerCore: 3.1,
  idleFraction: 0.2,
  reasons: ["1-minute load average is 3.10 per core, above the 0.5 quiet-host limit."],
};

/** One RSS sample per 250 ms poll across the 16 000 ms idle window. */
function series(value: number, count = 64): number[] {
  return Array.from({ length: count }, () => value);
}

/**
 * A full-length RSS series that is NOT constant: `base` everywhere except a
 * single `peak` sample in the middle.
 *
 * The whole point of the RSS statistic is which reduction of the sample
 * array decides the verdict, and a constant array cannot tell max from min,
 * mean or first-element. With a lone excursion all four differ: max is
 * `peak`, min and first are `base`, and the mean is `base + (peak-base)/n`.
 */
function excursion(base: number, peak: number, count = 64): number[] {
  const samples = series(base, count);
  return samples.map((value, index) => (index === Math.floor(count / 2) ? peak : value));
}

const MIB = 1024 * 1024;

function measurement(
  overrides: Partial<SupervisorIdleMeasurement> = {},
): SupervisorIdleMeasurement {
  return {
    rssSamplesBytes: series(50 * MIB),
    // 4 ticks over 16 s = 4 / (100 * 16) = 0.25% of one core.
    cpuTicksConsumed: 4,
    observedSpanMs: SUPERVISOR_IDLE_WINDOW_MS,
    sampleCount: 64,
    quietHost: QUIET,
    failures: [],
    ...overrides,
  };
}

const RC_OBJECT_ID = "release-candidate-object-id";

/** A 15 re-run record that satisfies 23:75 on its face; overridden per test. */
function rerunRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    releaseCandidateObjectId: RC_OBJECT_ID,
    runner: "packages/perf twin-worktree A/B runner",
    quietHost: true,
    capturedAt: "2026-07-25T00:00:00.000Z",
    contracts: [{ contractId: "cli-cold-start", outcome: "pass" }],
    ...overrides,
  };
}

/** The state of the world today: roadmap/23:75's re-run has produced no record. */
const NO_RERUN: PerformanceRerunEvidence = {
  releaseCandidateObjectId: RC_OBJECT_ID,
  unavailable: `no record at ${PERFORMANCE_RERUN_RECORD_PATH}.`,
};

function detailFor(contractId: string, details: readonly string[]): string {
  const line = details.find((candidate) => candidate.startsWith(contractId));
  if (line === undefined)
    throw new Error(`no detail line for ${contractId}: ${details.join(" | ")}`);
  return line;
}

describe("RELEASE_PERFORMANCE_BUDGETS", () => {
  it("encodes 05's documented idle budget, not invented numbers", () => {
    expect(SUPERVISOR_IDLE_RSS_BUDGET_BYTES).toBe(100 * MIB);
    expect(SUPERVISOR_IDLE_CPU_FRACTION_BUDGET).toBe(0.01);
    for (const budget of RELEASE_PERFORMANCE_BUDGETS) {
      expect(budget.rationale).toContain("roadmap/05");
    }
  });

  /**
   * 05's exit criterion is a "sustained no-op window". The original 6 000 ms
   * window spanned exactly ONE 5 s heartbeat, which is not "sustained" and
   * left the CPU series dominated by the single poll interval the heartbeat
   * landed in.
   *
   * Pinning the CONSTANT is only half the property — that the real probe
   * actually runs this window is pinned in the real-daemon test below.
   */
  it("spans several heartbeats, so 'sustained no-op window' is honest", () => {
    expect(SUPERVISOR_IDLE_WINDOW_MS).toBe(16_000);
    expect(SUPERVISOR_IDLE_WINDOW_MS / SUPERVISOR_IDLE_HEARTBEAT_MS).toBeGreaterThanOrEqual(3);
    expect(SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS).toBe(SUPERVISOR_IDLE_HEARTBEAT_MS);
  });

  /**
   * EVERY load-bearing constant, pinned to a LITERAL.
   *
   * The derived assertions elsewhere in this file are the right shape for
   * proving a RELATIONSHIP (that `SUPERVISOR_IDLE_MIN_SAMPLES` really is the
   * poll count the span floor implies, that the emitted evidence quotes the
   * divisor the arithmetic used), but they put the same symbol on both sides
   * of the comparison, so they move WITH the code and cancel themselves out
   * under mutation. Confirmed empirically before this block existed: retyping
   * `SAMPLE_INTERVAL_MS` from 250 to 1000, collapsing
   * `SUPERVISOR_IDLE_MIN_SAMPLES` to 2, and zeroing `STARTUP_WARMUP_MS` each
   * left all 50 tests green.
   *
   * Every number below is quoted from the source it comes from, so a re-pin
   * is a deliberate, reviewable edit to a documented figure rather than a
   * silent change to what this probe measures:
   *
   * - 100 MiB / 1% of a core / 5 s heartbeat — roadmap/05 §Idle resource budget.
   * - 16 000 ms window — three heartbeats, so "sustained no-op window"
   *   (roadmap/05:102) is honest.
   * - 250 ms cadence, and the 20-poll floor it implies across one heartbeat.
   * - 100 Hz — Linux's `/proc` USER_HZ, ABI-fixed on x86-64 and aarch64.
   * - 2 500 ms warmup — see `STARTUP_WARMUP_MS`; without it the first run of
   *   this probe reported 123% of a core against a 1% budget.
   *
   * The relationships are re-asserted alongside the literals so the two can
   * never drift apart: a cadence re-pin that forgets the floor fails here.
   */
  it("pins every load-bearing constant to a literal, not to another constant", () => {
    expect(SUPERVISOR_IDLE_RSS_BUDGET_BYTES).toBe(104_857_600);
    expect(SUPERVISOR_IDLE_CPU_FRACTION_BUDGET).toBe(0.01);
    expect(SUPERVISOR_IDLE_HEARTBEAT_MS).toBe(5_000);
    expect(SUPERVISOR_IDLE_WINDOW_MS).toBe(16_000);
    expect(SAMPLE_INTERVAL_MS).toBe(250);
    expect(SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS).toBe(5_000);
    expect(SUPERVISOR_IDLE_MIN_SAMPLES).toBe(20);
    expect(CLOCK_TICKS_PER_SECOND).toBe(100);
    expect(STARTUP_WARMUP_MS).toBe(2_500);

    // ...and the derivations still hold against those literals.
    expect(SUPERVISOR_IDLE_MIN_SAMPLES).toBe(
      SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS / SAMPLE_INTERVAL_MS,
    );
    expect(SUPERVISOR_IDLE_WINDOW_MS / SAMPLE_INTERVAL_MS).toBe(64);
  });
});

/**
 * roadmap/15:38 — the supervisor idle-resource budget is "owned end-to-end
 * by 05 … not a PerformanceContract, **never routed through
 * `packages/perf`**", and roadmap/05:38 calls it "a separate, self-contained
 * measurement of its own process, not a `packages/perf` benchmark".
 *
 * A grep-shaped conformance check, in the style of 05's own "no
 * `change_set.*` operation exists" exit criterion: the prose above is only
 * enforceable if something fails when the import comes back.
 */
describe("self-containment (roadmap/15:38, roadmap/05:38)", () => {
  it("does not route the idle budget through packages/perf", async () => {
    const source = await readFile(join(HERE, "performanceContracts.ts"), "utf8");
    // No dependency edge in either module syntax. Prose ABOUT `@eo/perf` is
    // expected and required (roadmap/15:32 excludes its `/proc` sampler from
    // this budget too, and that exclusion is documented in-file); a comment
    // naming the package is not routing a contract through it.
    expect(source).not.toMatch(/from\s+["']@eo\/perf/);
    expect(source).not.toMatch(/require\(\s*["']@eo\/perf/);
    expect(source).not.toMatch(/\bimport\(\s*["']@eo\/perf/);
    // The alternative the design forbids leaving unaddressed: the local
    // sampler exists, and says why it is local.
    expect(source).toContain("roadmap/15:32");
  });
});

describe("parseIdleProcSample", () => {
  const STAT =
    "4242 (node) S 4200 4242 4200 0 -1 4194304 1234 0 0 0 " +
    "37 11 0 0 20 0 11 0 987654 123456789 25000 " +
    Array.from({ length: 30 }, () => "0").join(" ");
  const STATUS = "Name:\tnode\nVmHWM:\t  123456 kB\nVmRSS:\t  101816 kB\nThreads:\t11\n";

  it("reads utime+stime as total ticks and VmRSS as current RSS", () => {
    const sample = parseIdleProcSample(STAT, STATUS);
    expect(sample?.totalTicks).toBe(48);
    expect(sample?.rssBytes).toBe(101_816 * 1024);
  });

  it("is not a sample at all when /proc/<pid>/stat was unreadable", () => {
    expect(parseIdleProcSample(undefined, STATUS)).toBeUndefined();
  });

  it("is not a sample when the tick fields are unparseable", () => {
    expect(parseIdleProcSample("4242 (node) S", STATUS)).toBeUndefined();
  });

  /**
   * `VmHWM` is deliberately NOT a fallback: it is cumulative since process
   * start, so it carries the startup peak into every idle sample and defeats
   * the warmup exclusion. A poll with no `VmRSS` contributes no RSS sample,
   * and fewer than `SUPERVISOR_IDLE_MIN_SAMPLES` RSS samples is
   * `inconclusive_blocking`, never a pass.
   */
  it("contributes no RSS sample when VmRSS is absent, and never falls back to VmHWM", () => {
    expect(
      parseIdleProcSample(STAT, "Name:\tnode\nVmHWM:\t  123456 kB\n")?.rssBytes,
    ).toBeUndefined();
    expect(parseIdleProcSample(STAT, undefined)?.rssBytes).toBeUndefined();
  });
});

describe("sampleIdleProcess", () => {
  it("samples a live process from /proc", async () => {
    const sample = await sampleIdleProcess(process.pid);
    expect(sample?.totalTicks).toBeGreaterThanOrEqual(0);
    expect(sample?.rssBytes ?? 0).toBeGreaterThan(0);
  });

  it("returns undefined for a pid that does not exist", async () => {
    await expect(sampleIdleProcess(999_999_999)).resolves.toBeUndefined();
  });
});

/**
 * The sampling loop is exercised through its injected sampler rather than by
 * booting three more supervisors. Every one of these paths ends in a
 * `failures` entry, which `undecidableReason` turns into
 * `inconclusive_blocking` for every contract — so each is a reason-producing
 * branch and each is pinned here rather than left to the real-daemon test,
 * which by construction takes none of them.
 */
describe("collectIdleSamples", () => {
  /**
   * Fake `/proc` sampler: replays `samples` in order, then reports the
   * process gone. It RECORDS what it handed back, so assertions can be made
   * against the polls that actually landed rather than against a poll count
   * inferred from the wall clock — this suite shares a host with other
   * agents, and a `delay(250)` that overshoots must not turn into a failure.
   */
  function replay(samples: readonly (IdleProcSample | undefined)[]) {
    const consumed: (IdleProcSample | undefined)[] = [];
    const calledAt: number[] = [];
    const sample = () => {
      const next = samples[consumed.length];
      consumed.push(next);
      calledAt.push(Date.now());
      return Promise.resolve(next);
    };
    return { sample, consumed, calledAt };
  }

  /**
   * Termination here is REPLAY-driven, not clock-driven: the assertions are
   * ratios over the polls the fake sampler actually served, so however many
   * of them the host let land inside the window, the property holds.
   *
   * The first in-loop poll is the one carrying no `VmRSS`, so "at least one
   * poll contributed no RSS sample" is true for any run in which any poll at
   * all landed.
   */
  it("aggregates ticks over the span it observed, skipping polls that carried no VmRSS", async () => {
    // Index 0 is the pre-window baseline; it counts toward neither
    // `sampleCount` nor `rssSamplesBytes`. Ticks rise by exactly one per
    // poll so `cpuTicksConsumed === sampleCount` holds for every prefix.
    const replayed = replay([
      { totalTicks: 10, rssBytes: 1024 },
      { totalTicks: 11 },
      ...Array.from({ length: 14 }, (_unused, index) => ({
        totalTicks: 12 + index,
        ...(index % 3 === 1 ? {} : { rssBytes: 2048 + index }),
      })),
    ]);

    const result = await collectIdleSamples({
      pid: 4242,
      windowMs: 2_000,
      warmupMs: 0,
      sample: replayed.sample,
    });

    const inLoop = replayed.consumed.slice(1);
    expect(result.failures).toEqual([]);
    expect(result.sampleCount).toBe(inLoop.length);
    expect(result.sampleCount).toBeGreaterThanOrEqual(1);
    // Exactly the polls that carried `VmRSS` contributed an RSS sample.
    expect(result.rssSamplesBytes.length).toBe(
      inLoop.filter((entry) => entry?.rssBytes !== undefined).length,
    );
    expect(result.rssSamplesBytes.length).toBeLessThan(result.sampleCount);
    expect(result.rssSamplesBytes).not.toContain(0);
    expect(result.cpuTicksConsumed).toBe(result.sampleCount);
  });

  /**
   * The warmup is not a tuning knob: without it the probe measures module
   * loading, socket bind and lease acquisition rather than idling — the
   * first run of this probe reported 123% of a core against a 1% budget.
   * Deleting or zeroing it must therefore be a test failure, not a silent
   * change of what is being measured.
   */
  it("excludes the startup warmup from the measurement before it samples anything", async () => {
    const replayed = replay([
      { totalTicks: 10, rssBytes: 1024 },
      { totalTicks: 11, rssBytes: 1024 },
    ]);
    const startedAt = Date.now();

    await collectIdleSamples({
      pid: 4242,
      windowMs: 0,
      warmupMs: 300,
      sample: replayed.sample,
    });

    expect(replayed.calledAt.length).toBeGreaterThanOrEqual(1);
    expect((replayed.calledAt[0] ?? 0) - startedAt).toBeGreaterThanOrEqual(250);
  });

  /**
   * THE PRODUCTION DEFAULT, not the injected parameter.
   *
   * The test above pins only what it passed in: it proves that `warmupMs`
   * is honoured, and says nothing about the value production actually uses.
   * With `warmupMs` supplied by every caller in this file, rewriting
   * `STARTUP_WARMUP_MS` to `0` left all 50 tests green — i.e. the constant
   * the file's own docstring calls load-bearing ("the first run of this
   * probe reported 123% of a core against a 1% budget") was unpinned, and
   * deleting the warmup would silently have turned this probe back into a
   * measurement of BOOTING rather than of IDLING.
   *
   * So: omit `warmupMs` entirely, exercise the default, and assert the
   * elapsed time against a LITERAL floor. `2_400` rather than `2_500` leaves
   * the timer its scheduling slack in one direction only — a zeroed or
   * deleted warmup lands three orders of magnitude below it.
   */
  it("waits the production STARTUP_WARMUP_MS default when no warmupMs is injected", async () => {
    const replayed = replay([{ totalTicks: 10, rssBytes: 1024 }]);
    const startedAt = Date.now();

    await collectIdleSamples({ pid: 4242, windowMs: 0, sample: replayed.sample });

    expect(replayed.calledAt.length).toBeGreaterThanOrEqual(1);
    expect((replayed.calledAt[0] ?? 0) - startedAt).toBeGreaterThanOrEqual(2_400);
  });

  /**
   * THE POLL CADENCE, measured rather than restated.
   *
   * `SAMPLE_INTERVAL_MS` was previously asserted only as
   * `SUPERVISOR_IDLE_WINDOW_MS / SAMPLE_INTERVAL_MS / 2` — the constant on
   * both sides of the comparison, so re-pinning it from 250 to 1000 moved
   * the expectation with the code and every test stayed green.
   *
   * Both bounds are literals and both are load-bearing in a different
   * direction. The floor catches a SLOWER cadence: at 1 000 ms this 2 000 ms
   * window yields a baseline poll plus about two more, well under five. The
   * ceiling catches the delay being removed altogether, which would spin the
   * loop and exhaust the replay array. The gap between them (5..20 against a
   * nominal 9) is this suite's tolerance for sharing a host — an
   * overshooting `delay` must cost samples, never turn the suite red.
   */
  it("polls at the SAMPLE_INTERVAL_MS cadence across the window it was given", async () => {
    const replayed = replay(
      Array.from({ length: 40 }, (_unused, index) => ({
        totalTicks: 100 + index,
        rssBytes: 1024,
      })),
    );

    await collectIdleSamples({
      pid: 4242,
      windowMs: 2_000,
      warmupMs: 0,
      sample: replayed.sample,
    });

    expect(replayed.calledAt.length).toBeGreaterThanOrEqual(5);
    expect(replayed.calledAt.length).toBeLessThanOrEqual(20);
  });

  it("reports the daemon exiting during startup, before the window opened", async () => {
    const result = await collectIdleSamples({
      pid: 4242,
      windowMs: 10_000,
      warmupMs: 0,
      sample: replay([undefined]).sample,
    });

    expect(result.failures.join(" ")).toContain(
      "exited during startup, before the idle window opened",
    );
    expect(result.sampleCount).toBe(0);
    expect(result.observedSpanMs).toBe(0);
  });

  /**
   * The branch the whole `observedSpanMs`/`cpuTicksConsumed` re-statement
   * design exists to serve: the loop breaks mid-window, so the aggregate must
   * be taken over the span ACTUALLY observed and never over the span
   * requested — otherwise a daemon that died two seconds in is scored as
   * having idled for sixteen.
   *
   * "STOPS" is half the property and was the unasserted half. Replacing the
   * loop's `break` with `continue` left every assertion below intact —
   * `sampleCount`, `cpuTicksConsumed` and `observedSpanMs` all freeze at the
   * last good poll either way — while the loop spun on to the full 10 000 ms
   * deadline re-polling a dead pid and pushing one duplicate failure string
   * per poll. The two assertions that separate the branches are therefore the
   * failure COUNT (one exit report, not one per remaining poll) and the wall
   * time (three polls, not a full window).
   */
  it("stops at a mid-window exit and reports the span actually observed, not the one requested", async () => {
    const startedAt = Date.now();
    const result = await collectIdleSamples({
      pid: 4242,
      windowMs: 10_000,
      warmupMs: 0,
      sample: replay([
        { totalTicks: 100, rssBytes: 1024 },
        { totalTicks: 103, rssBytes: 1024 },
        { totalTicks: 106, rssBytes: 1024 },
        undefined,
      ]).sample,
    });

    expect(result.failures.join(" ")).toContain("exited during the idle measurement window");
    expect(result.sampleCount).toBe(2);
    expect(result.cpuTicksConsumed).toBe(6);
    expect(result.observedSpanMs).toBeGreaterThanOrEqual(400);
    expect(result.observedSpanMs).toBeLessThan(10_000);
    // Exactly ONE exit report — a loop that kept polling a dead pid would push
    // one per remaining poll (~37 more) into the reason this check emits.
    expect(result.failures).toHaveLength(1);
    // ...and it returned after roughly three polls rather than at the deadline.
    // 5 000 ms is a deliberately loose ceiling: it leaves a contended host an
    // order of magnitude of slack over the ~750 ms this costs, and still sits
    // half a window below the 10 000 ms a non-terminating loop would take.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("reports that no samples were collected when the window closed before any poll landed", async () => {
    const result = await collectIdleSamples({
      pid: 4242,
      windowMs: 0,
      warmupMs: 0,
      sample: replay([{ totalTicks: 10, rssBytes: 1024 }]).sample,
    });

    expect(result.failures).toEqual(["no samples were collected from the supervisor daemon."]);
    expect(result.sampleCount).toBe(0);
    expect(result.rssSamplesBytes).toEqual([]);
  });
});

describe("decideReleaseContracts", () => {
  it("passes contracts comfortably inside their absolute budgets", () => {
    const decisions = decideReleaseContracts(measurement());
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) expect(decision.outcome).toBe("pass");
    const rss = decisions.find((d) => d.contractId === "supervisor-idle-rss");
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(rss?.observed).toBe(50 * MIB);
    expect(cpu?.observed).toBeCloseTo(0.0025, 10);
  });

  /**
   * The statistic is named, not implied. RSS is the max of the sampled
   * CURRENT RSS — the faithful reading of a ceiling — and it is a
   * single-boot reading, which the label states on its face because the
   * historical flakiness of this budget was ACROSS boots.
   */
  it("names the statistic each contract is decided on", () => {
    const decisions = decideReleaseContracts(measurement());
    const rss = decisions.find((d) => d.contractId === "supervisor-idle-rss");
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(rss?.statistic).toContain("max sampled current RSS");
    expect(rss?.statistic).toContain("single boot");
    expect(cpu?.statistic).toContain("total ticks");
    expect(cpu?.statistic).toContain("elapsed wall seconds");
    // The divisor is QUOTED FROM the constant the code divides by, never
    // re-typed: a re-pinned `CLOCK_TICKS_PER_SECOND` must not be able to
    // leave the evidence stating a divisor the arithmetic did not use.
    expect(cpu?.statistic).toContain(`${String(CLOCK_TICKS_PER_SECOND)} Hz`);
  });

  /**
   * THE RSS STATISTIC ITSELF, pinned against a NON-CONSTANT series.
   *
   * Every other RSS fixture in this file is a flat array, which cannot tell
   * a maximum from a minimum, a mean or a first-element read. Here a single
   * excursion decides the verdict in both directions: the 120 MiB peak
   * blocks even though the base, the first sample and the mean (41.25 MiB)
   * all sit comfortably inside the budget, and the in-budget case reports
   * the 60 MiB peak rather than the 40 MiB floor. A ceiling budget is
   * decided on the ceiling.
   */
  it("decides the RSS ceiling on the maximum sample, never an endpoint or an average", () => {
    const breaching = decideReleaseContracts(
      measurement({ rssSamplesBytes: excursion(40 * MIB, 120 * MIB) }),
    ).find((d) => d.contractId === "supervisor-idle-rss");
    expect(breaching?.observed).toBe(120 * MIB);
    expect(breaching?.outcome).toBe("block");

    const inBudget = decideReleaseContracts(
      measurement({ rssSamplesBytes: excursion(40 * MIB, 60 * MIB) }),
    ).find((d) => d.contractId === "supervisor-idle-rss");
    expect(inBudget?.observed).toBe(60 * MIB);
    expect(inBudget?.outcome).toBe("pass");
  });

  it("blocks a contract that breaches its absolute RSS budget", () => {
    const decisions = decideReleaseContracts(measurement({ rssSamplesBytes: series(200 * MIB) }));
    const rss = decisions.find((d) => d.contractId === "supervisor-idle-rss");
    expect(rss?.outcome).toBe("block");
    expect(rss?.observed).toBe(200 * MIB);
  });

  /** 100 ticks over 16 s = 6.25% of one core, against a 1% budget. */
  it("blocks a contract that breaches its absolute CPU budget", () => {
    const decisions = decideReleaseContracts(measurement({ cpuTicksConsumed: 100 }));
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(cpu?.outcome).toBe("block");
    expect(cpu?.observed).toBeCloseTo(0.0625, 10);
  });

  /**
   * THE BOUNDARY, both budgets, derived from the exported constants so a
   * re-pin cannot detach the assertion from the code.
   *
   * 05 states both numbers strictly — "<100 MiB RSS, <1% of one core"
   * (roadmap/05:102) — so a statistic sitting exactly ON the budget has not
   * met it. `<` versus `<=` is otherwise a one-character edit no fixture in
   * this file can see.
   */
  it("blocks a statistic sitting exactly on its budget, because 05 states both strictly", () => {
    const rss = decideReleaseContracts(
      measurement({ rssSamplesBytes: series(SUPERVISOR_IDLE_RSS_BUDGET_BYTES) }),
    ).find((d) => d.contractId === "supervisor-idle-rss");
    expect(rss?.observed).toBe(SUPERVISOR_IDLE_RSS_BUDGET_BYTES);
    expect(rss?.outcome).toBe("block");

    const onBudgetTicks =
      CLOCK_TICKS_PER_SECOND *
      (SUPERVISOR_IDLE_WINDOW_MS / 1000) *
      SUPERVISOR_IDLE_CPU_FRACTION_BUDGET;
    const cpu = decideReleaseContracts(measurement({ cpuTicksConsumed: onBudgetTicks })).find(
      (d) => d.contractId === "supervisor-idle-cpu",
    );
    expect(cpu?.observed).toBe(SUPERVISOR_IDLE_CPU_FRACTION_BUDGET);
    expect(cpu?.outcome).toBe("block");
  });

  /**
   * The whole-window aggregate at its coarsest: a single tick across the
   * window, which is the resolution floor (1/(100*16) = 0.000625, i.e. 6.25%
   * of the budget). It must still DECIDE.
   *
   * Historical note (this is the shape of the failure WP1 removed, and the
   * property that makes it unrepresentable is asserted below, not here): the
   * idle daemon's CPU cost arrives in whole integer ticks concentrated in
   * whichever poll intervals a heartbeat lands in, so a per-sample rate
   * series is mostly zeros with an occasional blip. Routed through
   * `packages/perf`'s bootstrap CI, such a series produced a 100% RELATIVE
   * noise bound and therefore `inconclusive_blocking`, while the measured
   * cost sat ~4x INSIDE the budget.
   */
  it("decides a single-tick whole-window aggregate rather than reducing a sparse per-poll series", () => {
    const decisions = decideReleaseContracts(measurement({ cpuTicksConsumed: 1 }));
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(cpu?.outcome).toBe("pass");
    expect(cpu?.observed).toBeCloseTo(0.000625, 10);
  });

  /**
   * The STRUCTURAL guard against the old failure, as opposed to a numeric
   * one: `SupervisorIdleMeasurement` carries CPU as two scalar endpoints
   * (ticks consumed, wall span) and no per-poll CPU series at all. There is
   * therefore nothing for a resampling statistic to be computed over — the
   * `inconclusive_blocking` verdict this work package removed is not
   * expressible against this shape, whatever any decision code later does.
   */
  it("exposes no per-poll CPU series for a resampling statistic to be taken over", () => {
    expect(Object.keys(measurement()).sort()).toEqual([
      "cpuTicksConsumed",
      "failures",
      "observedSpanMs",
      "quietHost",
      "rssSamplesBytes",
      "sampleCount",
    ]);
    const cpuValued = Object.entries(measurement()).filter(
      ([key, value]) => Array.isArray(value) && /cpu/i.test(key),
    );
    expect(cpuValued).toEqual([]);
  });

  /**
   * The clause this exit criterion exists for. A contended host cannot
   * decide a performance contract, and an undecided contract must not be
   * mistaken for a satisfied one.
   */
  it("reports inconclusive_blocking on a noisy host, whatever the numbers say", () => {
    const decisions = decideReleaseContracts(measurement({ quietHost: NOISY }));
    for (const decision of decisions) {
      expect(decision.outcome).toBe("inconclusive_blocking");
      expect(decision.note).toContain("not quiet");
      expect(decision.observed).toBeUndefined();
    }
  });

  it("reports inconclusive_blocking when the measurement itself failed", () => {
    const decisions = decideReleaseContracts(
      measurement({ failures: ["supervisor daemon exited during startup."] }),
    );
    for (const decision of decisions) {
      expect(decision.outcome).toBe("inconclusive_blocking");
      expect(decision.note).toContain("exited during startup");
    }
  });

  it("reports inconclusive_blocking when too few polls landed inside the window", () => {
    const decisions = decideReleaseContracts(
      measurement({ sampleCount: SUPERVISOR_IDLE_MIN_SAMPLES - 1 }),
    );
    for (const decision of decisions) {
      expect(decision.outcome).toBe("inconclusive_blocking");
      expect(decision.note).toContain("sample(s)");
    }
  });

  /**
   * THE POLL FLOOR ITSELF, straddled by two LITERAL fixtures.
   *
   * Every fixture above is written `SUPERVISOR_IDLE_MIN_SAMPLES - 1`, which
   * is below the floor for any value the floor takes — so collapsing
   * `SUPERVISOR_IDLE_MIN_SAMPLES` from 20 to 2 left all 50 tests green and
   * the floor could be lowered arbitrarily without anything failing. Neither
   * assertion below moves when the constant does: 19 samples must be too
   * few (a lowered floor decides it, and this goes red) and 20 must be
   * enough (a raised floor refuses to decide it, and this goes red).
   *
   * 20 is one full 5 s heartbeat at the 250 ms cadence. Below that the
   * window can fall between two heartbeats and report a daemon that has an
   * idle cost as having none.
   */
  it("straddles the 20-poll floor: 19 polls decide nothing, 20 decide the contracts", () => {
    const tooFew = decideReleaseContracts(measurement({ sampleCount: 19 }));
    for (const decision of tooFew) {
      expect(decision.outcome).toBe("inconclusive_blocking");
      expect(decision.note).toContain("only 19 sample(s)");
      expect(decision.observed).toBeUndefined();
    }

    const enough = decideReleaseContracts(measurement({ sampleCount: 20 }));
    for (const decision of enough) {
      expect(decision.outcome).toBe("pass");
      expect(decision.observed).toBeDefined();
    }
  });

  /** The sampling loop breaks when the daemon exits, so the observed span can be far shorter than the requested window. */
  it("reports inconclusive_blocking when the observed span is shorter than one heartbeat", () => {
    const decisions = decideReleaseContracts(
      measurement({ observedSpanMs: SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS - 1 }),
    );
    for (const decision of decisions) {
      expect(decision.outcome).toBe("inconclusive_blocking");
      expect(decision.note).toContain("observed idle span");
    }
  });

  /**
   * The span floor straddled the same way, and for the same reason: the
   * fixture above is `SUPERVISOR_IDLE_MIN_OBSERVED_SPAN_MS - 1`, which is
   * short of the floor wherever the floor sits. 4 999 ms must decide
   * nothing and 5 000 ms — one 5 s heartbeat, roadmap/05 §Idle resource
   * budget — must decide both contracts.
   */
  it("straddles the 5 000 ms span floor: 4 999 ms decides nothing, 5 000 ms decides", () => {
    const tooShort = decideReleaseContracts(measurement({ observedSpanMs: 4_999 }));
    for (const decision of tooShort) {
      expect(decision.outcome).toBe("inconclusive_blocking");
      expect(decision.note).toContain("4999 ms");
    }

    const longEnough = decideReleaseContracts(measurement({ observedSpanMs: 5_000 }));
    for (const decision of longEnough) {
      expect(decision.outcome).toBe("pass");
    }
    // 4 ticks over 5 s = 0.8% of one core, decided against the 1% budget.
    expect(longEnough.find((d) => d.contractId === "supervisor-idle-cpu")?.observed).toBeCloseTo(
      0.008,
      10,
    );
  });

  /** RSS availability is per-metric: a poll can carry ticks but no `VmRSS`. */
  it("reports inconclusive_blocking for RSS alone when no VmRSS was ever readable", () => {
    const decisions = decideReleaseContracts(measurement({ rssSamplesBytes: [] }));
    const rss = decisions.find((d) => d.contractId === "supervisor-idle-rss");
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(rss?.outcome).toBe("inconclusive_blocking");
    expect(rss?.note).toContain("VmRSS");
    expect(rss?.note).toContain("only 0 RSS sample(s)");
    expect(cpu?.outcome).toBe("pass");
  });

  /**
   * The RSS floor the code APPLIES, matching what its comments claim. One
   * readable `VmRSS` out of 64 polls is not a ceiling — it is a single
   * reading — so the same `SUPERVISOR_IDLE_MIN_SAMPLES` floor that governs
   * the poll count governs the RSS series. CPU is unaffected: its endpoints
   * come from `/proc/<pid>/stat`, which was readable throughout.
   */
  it("reports inconclusive_blocking for RSS when fewer VmRSS samples landed than the floor", () => {
    const decisions = decideReleaseContracts(
      measurement({ rssSamplesBytes: series(50 * MIB, SUPERVISOR_IDLE_MIN_SAMPLES - 1) }),
    );
    const rss = decisions.find((d) => d.contractId === "supervisor-idle-rss");
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(rss?.outcome).toBe("inconclusive_blocking");
    expect(rss?.note).toContain(String(SUPERVISOR_IDLE_MIN_SAMPLES - 1));
    expect(rss?.note).toContain(String(SUPERVISOR_IDLE_MIN_SAMPLES));
    expect(rss?.observed).toBeUndefined();
    expect(cpu?.outcome).toBe("pass");
  });

  /**
   * The RSS floor straddled by LITERAL series lengths, for the same reason
   * as the poll floor: `SUPERVISOR_IDLE_MIN_SAMPLES - 1` is short of the
   * floor wherever the floor sits, so the test above cannot see the floor
   * move. 19 readable `VmRSS` samples are a handful of observations, not a
   * ceiling; 20 span one heartbeat and are.
   */
  it("straddles the 20-sample RSS floor: 19 VmRSS readings decide nothing, 20 decide", () => {
    const tooFew = decideReleaseContracts(
      measurement({ rssSamplesBytes: series(50 * MIB, 19) }),
    ).find((d) => d.contractId === "supervisor-idle-rss");
    expect(tooFew?.outcome).toBe("inconclusive_blocking");
    expect(tooFew?.note).toContain("only 19 RSS sample(s)");
    expect(tooFew?.observed).toBeUndefined();

    const enough = decideReleaseContracts(
      measurement({ rssSamplesBytes: series(50 * MIB, 20) }),
    ).find((d) => d.contractId === "supervisor-idle-rss");
    expect(enough?.outcome).toBe("pass");
    expect(enough?.observed).toBe(50 * MIB);
  });
});

/**
 * roadmap/23:75's OTHER obligation, read as evidence rather than assumed.
 *
 * The record does not exist in this repository and this check does not
 * create it — the reader's job is to report its absence precisely, and to
 * refuse to be satisfied by a file that is present but does not describe a
 * real re-run of the release candidate on a quiet host.
 */
describe("readPerformanceRerunEvidence", () => {
  const ORIGINAL = process.env[PERFORMANCE_RERUN_RECORD_ENV];

  /**
   * CLEARED before each case, not merely restored after.
   *
   * `release-e2e.yml` exports `$EO_PERF_CONTRACT_RERUN_RECORD` to
   * `$GITHUB_ENV` once the re-run producer succeeds, so it is set for the
   * whole harness run — and the cases below that describe the IN-REPO path
   * then silently read that record instead. The `afterEach` restore alone
   * left the ambient value in force for every case that did not set its own.
   * Latent until the producer actually succeeded in CI, which is exactly the
   * kind of bug that surfaces on the release cut and nowhere earlier.
   */
  beforeEach(() => {
    delete process.env[PERFORMANCE_RERUN_RECORD_ENV];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[PERFORMANCE_RERUN_RECORD_ENV];
    else process.env[PERFORMANCE_RERUN_RECORD_ENV] = ORIGINAL;
  });

  async function withRecordFile<T>(
    content: string,
    body: (path: string) => T | Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "eo-perf-rerun-"));
    const path = join(dir, "perf-contract-rerun.json");
    await writeFile(path, content, "utf8");
    try {
      return await body(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * THE TWO NAMES A PRODUCER HAS TO AGREE WITH, pinned to literals.
   *
   * Every other assertion in this describe puts
   * `PERFORMANCE_RERUN_RECORD_PATH` / `PERFORMANCE_RERUN_RECORD_ENV` on BOTH
   * sides of the comparison, so the expectation moves with the code and
   * cancels itself out: rewriting the path to `tmp/whatever/rerun.json`, or
   * the variable to `EO_NOT_THE_LEDGER_NAME`, left all 68 tests green.
   *
   * Neither is an internal detail. They are the seam a producer of the 23:75
   * record has to write to and a CI leg has to export, and they are chosen to
   * match the sibling consumer this reader was modelled on
   * (`arm64Verification.ts:70-71` — `docs/evidence/phase-23/arm64-run-record.json`
   * and `EO_ARM64_RUN_RECORD`): same directory, record named for what it
   * records, override named `EO_` + that same subject. A silent rename here
   * breaks a handshake with a producer that does not exist yet and therefore
   * cannot fail loudly on the other side.
   */
  it("pins the record path and its override variable to their literal names", () => {
    expect(PERFORMANCE_RERUN_RECORD_PATH).toBe("docs/evidence/phase-23/perf-contract-rerun.json");
    expect(PERFORMANCE_RERUN_RECORD_ENV).toBe("EO_PERF_CONTRACT_RERUN_RECORD");
  });

  it("reports the exact path it looked at when no record exists", () => {
    const evidence = readPerformanceRerunEvidence(join(REPO_ROOT, "does-not-exist"), RC_OBJECT_ID);
    expect(evidence.record).toBeUndefined();
    expect(evidence.unavailable).toContain(PERFORMANCE_RERUN_RECORD_PATH);
  });

  it("reads a schema-valid record from $EO_PERF_CONTRACT_RERUN_RECORD", async () => {
    await withRecordFile(JSON.stringify(rerunRecord()), (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.unavailable).toBeUndefined();
      expect(evidence.record?.releaseCandidateObjectId).toBe(RC_OBJECT_ID);
      expect(evidence.record?.contracts).toHaveLength(1);
    });
  });

  it("reports unreadable JSON rather than throwing out of the release run", async () => {
    await withRecordFile("{ not json", (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.record).toBeUndefined();
      expect(evidence.unavailable).toContain("JSON");
    });
  });

  it("rejects a record that does not match the re-run schema", async () => {
    await withRecordFile(JSON.stringify({ ...rerunRecord(), contracts: [] }), (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.record).toBeUndefined();
      expect(evidence.unavailable).toContain("does not match");
    });
  });

  /**
   * `.strict()` is the whole point of the schema — `PerformanceRerunRecordSchema`'s
   * own docstring says it is there "so a record carrying fields this check
   * does not understand is reported rather than silently half-read" — and the
   * tests below are what makes that a property rather than a sentence. Without
   * them the whole suite stayed green with `.strict()` deleted from either
   * schema, with any member made `.optional()`, or with a `.min(1)` dropped: a
   * producer that grew or dropped a field would be read as if it had not. The
   * twin consumer already pins the unknown-key half
   * (`arm64Verification.test.ts` — "reports `malformed` on an unknown extra
   * key"); this side was asserting more than it verified.
   */
  it("rejects a record carrying a top-level key this check does not understand", async () => {
    await withRecordFile(
      JSON.stringify({ ...rerunRecord(), unexpectedTopLevelKey: "producer drift" }),
      (path) => {
        process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
        const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
        expect(evidence.record).toBeUndefined();
        expect(evidence.unavailable).toContain("does not match");
        expect(evidence.unavailable).toContain("unexpectedTopLevelKey");
      },
    );
  });

  it("rejects a contract entry carrying a key this check does not understand", async () => {
    const drifted = rerunRecord({
      contracts: [
        { contractId: "cli-cold-start", outcome: "pass", unexpectedEntryKey: "producer drift" },
      ],
    });
    await withRecordFile(JSON.stringify(drifted), (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.record).toBeUndefined();
      expect(evidence.unavailable).toContain("does not match");
      expect(evidence.unavailable).toContain("unexpectedEntryKey");
    });
  });

  // One case per member the schema declares required. `JSON.stringify` drops
  // an explicitly-`undefined` member, so each writes a record with that key
  // absent rather than null — the shape a producer that stopped emitting it
  // would actually ship.
  it.each(["releaseCandidateObjectId", "runner", "quietHost", "capturedAt", "contracts"])(
    "rejects a record that omits %s",
    async (member) => {
      await withRecordFile(JSON.stringify(rerunRecord({ [member]: undefined })), (path) => {
        process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
        const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
        expect(evidence.record).toBeUndefined();
        expect(evidence.unavailable).toContain("does not match");
        expect(evidence.unavailable).toContain(member);
      });
    },
  );

  // The contract entries carry the verdicts the whole record exists to
  // report, so the same standard applies inside the array: a nameless
  // contract, or an outcome outside 02's `PERFORMANCE_OUTCOMES`, is drift.
  it("rejects a contract entry with a blank contractId", async () => {
    const drifted = rerunRecord({ contracts: [{ contractId: "", outcome: "pass" }] });
    await withRecordFile(JSON.stringify(drifted), (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.record).toBeUndefined();
      expect(evidence.unavailable).toContain("does not match");
      expect(evidence.unavailable).toContain("contractId");
    });
  });

  /**
   * ...and the same "is it there at all" standard, INSIDE the array.
   *
   * The two cases above only constrain a member that is PRESENT: a blank
   * `contractId` still fails `.min(1)` and `"green"` still fails the enum even
   * when the member is `.optional()`. So marking either inner member optional
   * left all 68 tests green, and a record whose `contracts` array held `[{}]` —
   * a nameless, verdict-less entry — parsed as a valid re-run. That is the
   * "producer drift silently half-read" outcome the `.strict()` schema exists
   * to prevent, arrived at from the missing-member side rather than the
   * extra-member side.
   */
  it.each(["contractId", "outcome"])("rejects a contract entry that omits %s", async (member) => {
    const entry: Record<string, unknown> = { contractId: "cli-cold-start", outcome: "pass" };
    delete entry[member];
    await withRecordFile(JSON.stringify(rerunRecord({ contracts: [entry] })), (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.record).toBeUndefined();
      expect(evidence.unavailable).toContain("does not match");
      expect(evidence.unavailable).toContain(member);
    });
  });

  it("rejects an outcome outside 02's canonical PERFORMANCE_OUTCOMES", async () => {
    const drifted = rerunRecord({
      contracts: [{ contractId: "cli-cold-start", outcome: "green" }],
    });
    await withRecordFile(JSON.stringify(drifted), (path) => {
      process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
      const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
      expect(evidence.record).toBeUndefined();
      expect(evidence.unavailable).toContain("does not match");
      expect(evidence.unavailable).toContain("outcome");
    });
  });

  // A present-but-empty string is not a statement of anything, and every one
  // of these members exists to say something specific about the re-run.
  it.each(["releaseCandidateObjectId", "runner", "capturedAt"])(
    "rejects a record whose %s is blank",
    async (member) => {
      await withRecordFile(JSON.stringify(rerunRecord({ [member]: "" })), (path) => {
        process.env[PERFORMANCE_RERUN_RECORD_ENV] = path;
        const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
        expect(evidence.record).toBeUndefined();
        expect(evidence.unavailable).toContain("does not match");
        expect(evidence.unavailable).toContain(member);
      });
    },
  );

  /**
   * The blank-override branch, asserted on the path ACTUALLY RESOLVED.
   *
   * `PERFORMANCE_RERUN_RECORD_PATH` appears verbatim in every `unavailable`
   * message this function builds, whichever path it looked at, so the
   * previous `toContain(PERFORMANCE_RERUN_RECORD_PATH)` held even when the
   * blank override WAS honoured — deleting `|| override.trim() === ""` left
   * all 50 tests green. The "looked at" clause is the only part of the
   * message that distinguishes the two branches, so that is what is pinned:
   * the repo-root join, and explicitly not the whitespace override.
   */
  it("ignores a blank override and falls back to the in-repo path", () => {
    process.env[PERFORMANCE_RERUN_RECORD_ENV] = "   ";
    const repoRoot = join(REPO_ROOT, "does-not-exist");
    const evidence = readPerformanceRerunEvidence(repoRoot, RC_OBJECT_ID);
    expect(evidence.record).toBeUndefined();
    expect(evidence.unavailable).toContain(
      `looked at ${join(repoRoot, PERFORMANCE_RERUN_RECORD_PATH)}`,
    );
  });

  /**
   * The state this release is actually in. Stated as a test so that the
   * moment 23:75's re-run starts emitting a record, this assertion is the
   * thing that fails and forces the handoff docs to be re-read.
   */
  it("finds no 15 re-run record in this repository today", () => {
    delete process.env[PERFORMANCE_RERUN_RECORD_ENV];
    const evidence = readPerformanceRerunEvidence(REPO_ROOT, RC_OBJECT_ID);
    expect(evidence.record).toBeUndefined();
  });
});

describe("checkPerformanceContracts", () => {
  /**
   * THE HONESTY TEST for this checklist item. roadmap/23 books TWO
   * obligations against the single `performance-contracts` item: 05's
   * supervisor idle-budget re-measurement (23:27, and 23:65's carry-forward
   * row) and 15's OWN re-run — the `PerformanceContract` decision engine and
   * twin-worktree A/B runner — "on a quiet host for the release-candidate's
   * real verdicts" (23:75). `RELEASE_GATE_CHECKLIST`'s description cites 15
   * (`e2e/report/src/checklist.ts:89-95`).
   *
   * This check measures the first and consumes a RECORD of the second, so
   * with no such record it must not report PASS however well the idle budget
   * does. A consumer of `e2e/release-gate-report.json` reads the verdict,
   * not the detail lines — a caveat that does not move the verdict is
   * exactly the "asserts more than it verifies" failure this harness exists
   * to catch.
   */
  it("never PASSes while roadmap/23:75's separate 15 re-run has no evidence", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain(PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON);
    expect(PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON).toContain("23:75");
    // ...and it names the artifact whose absence it is reporting, so the
    // reason is a locator rather than an unfalsifiable statement.
    expect(result.reasons.join(" ")).toContain(PERFORMANCE_RERUN_RECORD_PATH);
  });

  /**
   * The counterpart, and the reason this reason is EVIDENCE-DRIVEN rather
   * than a constant: with a genuine 23:75 record for this release candidate
   * alongside a clean idle measurement, the item PASSes. A check whose PASS
   * path is unreachable in production reports nothing about the thing it
   * measures — a 500 MiB idle RSS regression would add a reason to an item
   * that was already FAIL, and no verdict would move.
   *
   * NOTE: no such record exists in this repository, and this suite does not
   * write one into it. The fixture below is a temp-file override.
   */
  it("PASSes only when BOTH obligations are evidenced — the 15 re-run record and a clean idle budget", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: {
        releaseCandidateObjectId: RC_OBJECT_ID,
        record: {
          releaseCandidateObjectId: RC_OBJECT_ID,
          runner: "packages/perf twin-worktree A/B runner",
          quietHost: true,
          capturedAt: "2026-07-25T00:00:00.000Z",
          contracts: [{ contractId: "cli-cold-start", outcome: "pass" }],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.verdict).toBe("PASS");
    expect(result.details.join(" ")).toContain("twin-worktree");
  });

  it("rejects a 15 re-run record taken against a different release candidate", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: {
        releaseCandidateObjectId: RC_OBJECT_ID,
        record: {
          releaseCandidateObjectId: "some-other-object-id",
          runner: "packages/perf twin-worktree A/B runner",
          quietHost: true,
          capturedAt: "2026-07-25T00:00:00.000Z",
          contracts: [{ contractId: "cli-cold-start", outcome: "pass" }],
        },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("some-other-object-id");
    expect(result.reasons.join(" ")).toContain(RC_OBJECT_ID);
  });

  /** 23:75 says "on a quiet host" — a contended re-run is not the re-run that was asked for. */
  it("rejects a 15 re-run record that was not taken on a quiet host", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: {
        releaseCandidateObjectId: RC_OBJECT_ID,
        record: {
          releaseCandidateObjectId: RC_OBJECT_ID,
          runner: "packages/perf twin-worktree A/B runner",
          quietHost: false,
          capturedAt: "2026-07-25T00:00:00.000Z",
          contracts: [{ contractId: "cli-cold-start", outcome: "pass" }],
        },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("quiet host");
  });

  it("FAILs when the 15 re-run's own contracts did not all pass", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: {
        releaseCandidateObjectId: RC_OBJECT_ID,
        record: {
          releaseCandidateObjectId: RC_OBJECT_ID,
          runner: "packages/perf twin-worktree A/B runner",
          quietHost: true,
          capturedAt: "2026-07-25T00:00:00.000Z",
          contracts: [
            { contractId: "cli-cold-start", outcome: "pass" },
            { contractId: "scheduler-throughput", outcome: "inconclusive_blocking" },
          ],
        },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("scheduler-throughput");
    expect(result.reasons.join(" ")).toContain("inconclusive_blocking");
  });

  /**
   * 23:27/23:65's evidence must survive on the face of the report whatever
   * the 23:75 half is doing — the re-measurement is exactly what that half
   * of the criterion asked for, and collapsing the idle contracts to express
   * an unrelated gap would destroy it.
   */
  it("keeps 05's idle verdicts decided and quotable, with the 15 re-run its only outstanding reason", () => {
    const decisions = decideReleaseContracts(measurement());
    const result = checkPerformanceContracts({
      decisions,
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });

    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON);
    for (const decision of decisions) {
      expect(decision.outcome).toBe("pass");
      expect(decision.observed).toBeDefined();
    }
    expect(detailFor("supervisor-idle-rss", result.details)).toContain("pass");
  });

  /**
   * The report used to render `observed max` of the sample array while the
   * decision was taken on a different statistic entirely. A detail line that
   * names a statistic the verdict did not use is a false account of the
   * verdict, so the format is asserted, not assumed — against a series whose
   * maximum is NOT its every element, so the line cannot quote a
   * fixture-wide constant and be right by accident.
   */
  it("reports the statistic the verdict was actually decided on", () => {
    const decisions = decideReleaseContracts(
      measurement({ rssSamplesBytes: excursion(40 * MIB, 60 * MIB) }),
    );
    const result = checkPerformanceContracts({
      decisions,
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });

    const rssLine = detailFor("supervisor-idle-rss", result.details);
    expect(rssLine).toContain("max sampled current RSS");
    expect(rssLine).toContain("single boot");
    // The MAXIMUM, not the 40 MiB base the rest of the series sits at.
    // Rounded MiB AND the raw byte count: at two decimals a breach 40 KiB
    // over budget would otherwise render budget and observed as the same
    // number next to a `block`, leaving the verdict unexplainable from the
    // line that reports it.
    expect(rssLine).toContain("60.00 MiB");
    expect(rssLine).toContain(String(60 * MIB));
    expect(rssLine).not.toContain("40.00 MiB");
    expect(rssLine).toContain(String(SUPERVISOR_IDLE_RSS_BUDGET_BYTES));
    expect(rssLine).not.toContain("observed max");

    const cpuLine = detailFor("supervisor-idle-cpu", result.details);
    expect(cpuLine).toContain("total ticks");
    expect(cpuLine).toContain("0.250% of one core");
    expect(cpuLine).toContain("64 sample(s) over 16000 ms");
  });

  /**
   * roadmap/23 carries two performance obligations (23:27/23:65 for 05's
   * idle budget, 23:75 for 15's own re-run) against one checklist item that
   * cites 15. The evidence has to say which is which, and where the second
   * one's record is read from — a gate that asserts more than it verifies is
   * the failure mode this harness exists to prevent.
   */
  it("states which of roadmap/23's two performance obligations it measures, and which it reads", () => {
    const withDecisions = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });
    const empty = checkPerformanceContracts({
      decisions: [],
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });

    for (const result of [withDecisions, empty]) {
      // Asserted on the SCOPE LINE, not on `details.join(" ")`: the record
      // path also appears in the "15 re-run record: …" line below it, so the
      // joined form was satisfied no matter what the scope line said —
      // dropping the path from `SCOPE_DETAIL` left every test green.
      const scope = detailFor("scope:", result.details);
      expect(scope).toContain("23:27");
      expect(scope).toContain("23:75");
      expect(scope).toContain(PERFORMANCE_RERUN_RECORD_PATH);
      // And it BLOCKS on it — including on the early-return path for an
      // empty contract set, where the scope gap is no less real.
      expect(result.reasons.join(" ")).toContain(PERFORMANCE_CONTRACT_RERUN_UNEVIDENCED_REASON);
    }
  });

  it("says so plainly when a contract carries no decided statistic", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement({ quietHost: NOISY })),
      quietHost: NOISY,
      failures: [],
      rerunEvidence: NO_RERUN,
    });
    expect(detailFor("supervisor-idle-cpu", result.details)).toContain("not decided");
  });

  it("FAILs on an empty contract set — never a vacuous 'all satisfied'", () => {
    const result = checkPerformanceContracts({
      decisions: [],
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no performance contracts were measured");
  });

  it("FAILs on a budget breach, quoting the statistic and the budget", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement({ rssSamplesBytes: series(200 * MIB) })),
      quietHost: QUIET,
      failures: [],
      rerunEvidence: NO_RERUN,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("BLOCK");
    expect(result.reasons.join(" ")).toContain("max sampled current RSS");
    expect(result.reasons.join(" ")).toContain("200.00 MiB");
  });

  it("FAILs on an inconclusive contract, quoting why it could not be decided", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement({ quietHost: NOISY })),
      quietHost: NOISY,
      failures: [],
      rerunEvidence: NO_RERUN,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("INCONCLUSIVE");
    expect(result.reasons.join(" ")).toContain("satisfied rather than skipped");
  });

  it("FAILs when the measurement itself could not be taken", () => {
    const result = checkPerformanceContracts({
      decisions: [],
      quietHost: QUIET,
      failures: ["supervisor daemon exited during startup, before the idle window opened."],
      rerunEvidence: NO_RERUN,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("measurement failed");
  });
});

describe("measureSupervisorIdle — against the real daemon", () => {
  it("reports a build failure rather than crashing when the daemon is not built", async () => {
    const result = await measureSupervisorIdle(join(REPO_ROOT, "does-not-exist"), 100);
    expect(result.failures.join(" ")).toContain("not built");
    expect(result.rssSamplesBytes).toEqual([]);
    expect(result.sampleCount).toBe(0);
    expect(result.observedSpanMs).toBe(0);
  });

  it("names the built daemon entry point", () => {
    expect(supervisordEntryPoint(REPO_ROOT)).toBe(
      join(REPO_ROOT, "packages", "cli", "dist", "bin", "supervisord.js"),
    );
  });

  /**
   * The real thing: boots the actual supervisor, lets it idle past the
   * warmup, and samples `/proc`. Asserts shape rather than a specific
   * verdict — the numbers belong to the host, but the probe must always
   * produce a decidable measurement or an explicit failure.
   *
   * The span and poll-count bounds are DERIVED FROM
   * `SUPERVISOR_IDLE_WINDOW_MS`, not from the heartbeat floor: pinning the
   * constant to 16 000 ms proves nothing if the probe's own default window
   * is still 6 000. The poll bound is deliberately half the nominal count —
   * this host is shared, and an overshooting `delay(250)` must cost samples,
   * not turn the suite red — but it still sits above the ~24 polls a 6 s
   * window could produce.
   */
  it("collects a real, decidable idle measurement across the full sustained window", async () => {
    const result = await measureSupervisorIdle(REPO_ROOT);
    if (result.failures.length > 0) {
      // A daemon that could not boot here is a real, reported condition —
      // never silently treated as a pass.
      expect(result.failures.join(" ").length).toBeGreaterThan(0);
      return;
    }
    expect(result.observedSpanMs).toBeGreaterThanOrEqual(SUPERVISOR_IDLE_WINDOW_MS - 500);
    expect(result.sampleCount).toBeGreaterThanOrEqual(
      SUPERVISOR_IDLE_WINDOW_MS / SAMPLE_INTERVAL_MS / 2,
    );
    // The same bound as a LITERAL. The derived form above carries
    // `SAMPLE_INTERVAL_MS` on both sides of the comparison, so it relaxes
    // itself the moment the cadence is re-pinned; this one does not. It is
    // also, deliberately, still above the ~24 polls a 6 s window could yield.
    expect(result.sampleCount).toBeGreaterThanOrEqual(32);
    expect(result.sampleCount).toBeGreaterThanOrEqual(SUPERVISOR_IDLE_MIN_SAMPLES);
    expect(result.observedSpanMs).toBeGreaterThanOrEqual(15_500);
    expect(result.cpuTicksConsumed).toBeGreaterThanOrEqual(0);
    expect(result.rssSamplesBytes.length).toBeGreaterThanOrEqual(SUPERVISOR_IDLE_MIN_SAMPLES);
    for (const rss of result.rssSamplesBytes) expect(rss).toBeGreaterThan(0);
  });

  /**
   * TEARDOWN WAS COMPLETELY UNPINNED. Deleting the `SIGTERM` from this
   * probe's `finally` block left every test in this file green while
   * leaking a live `supervisord.js` per release run — observed for real on
   * this host (an orphaned pid survived a mutation run and had to be killed
   * by hand).
   *
   * Two assertions, because either alone is weak: `escalatedToSigkill`
   * pins that the SIGTERM itself did the work (a `SIGKILL`-only teardown
   * would still leave the process gone), and `ESRCH` pins that the process
   * is actually reaped by the time the probe resolves rather than merely
   * signalled. A short window is used deliberately — this test is about
   * teardown, and the full sustained window is exercised above.
   */
  it("reaps the daemon before it resolves — no orphaned supervisord, and SIGTERM is what did it", async () => {
    const result = await measureSupervisorIdle(REPO_ROOT, 1_000);
    const teardown = result.teardown;
    if (teardown === undefined) {
      // Nothing was spawned, so there is nothing to reap — the only honest
      // reason for that, asserted rather than assumed.
      expect(result.failures.join(" ")).toContain("not built");
      return;
    }
    expect(teardown.escalatedToSigkill).toBe(false);
    expect(errnoOf(() => process.kill(teardown.pid, 0))).toBe("ESRCH");
  });
});

/** The `errno` a thrown `NodeJS.ErrnoException` carried, or `undefined` if nothing threw. */
function errnoOf(action: () => void): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

describe("terminateDaemon", () => {
  const spawned: ChildProcess[] = [];

  afterEach(() => {
    for (const child of spawned.splice(0)) child.kill("SIGKILL");
  });

  function spawnChild(script: string): ChildProcess {
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    spawned.push(child);
    return child;
  }

  /**
   * Spawns a child and waits for it to SAY it is ready.
   *
   * Signalling a Node process that has not finished evaluating `-e` yet
   * signals one with no handler installed, and the default action ends it —
   * which made the SIGKILL-escalation case below silently pass through the
   * SIGTERM branch instead. The readiness line removes the race.
   */
  async function spawnReadyChild(script: string): Promise<ChildProcess> {
    const child = spawnChild(`${script}\nconsole.log("ready");`);
    await new Promise((resolve) => child.stdout?.once("data", resolve));
    return child;
  }

  it("ends a well-behaved child on SIGTERM alone, and waits for it to be gone", async () => {
    const child = await spawnReadyChild("setInterval(() => {}, 1000);");
    const pid = child.pid;
    expect(pid).toBeDefined();

    const teardown = await terminateDaemon(child);
    expect(teardown).toEqual({ pid, escalatedToSigkill: false });
    expect(errnoOf(() => process.kill(pid as number, 0))).toBe("ESRCH");
  });

  /**
   * A daemon that ignores SIGTERM must not hang the release run, and the
   * escalation must be REPORTED rather than silently papered over: a probe
   * that always needed a SIGKILL is a different fact about the daemon than
   * one that never did.
   */
  it("escalates to SIGKILL, and says so, when the child ignores SIGTERM", async () => {
    const child = await spawnReadyChild(
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    );
    const pid = child.pid;

    const teardown = await terminateDaemon(child, 300);
    expect(teardown).toEqual({ pid, escalatedToSigkill: true });
    expect(errnoOf(() => process.kill(pid as number, 0))).toBe("ESRCH");
  });

  it("is a no-op on a child that has already exited", async () => {
    const child = spawnChild("");
    await new Promise((resolve) => child.once("exit", resolve));

    expect(await terminateDaemon(child, 300)).toEqual({
      pid: child.pid,
      escalatedToSigkill: false,
    });
  });

  it("reports no teardown at all for a process that never spawned", async () => {
    const child = spawn(join(tmpdir(), "eo-no-such-binary"), [], { stdio: "ignore" });
    child.on("error", () => {
      // A failed spawn emits `error`, never `exit`; swallowed so the failure
      // is a return value rather than an unhandled event.
    });
    expect(child.pid).toBeUndefined();
    expect(await terminateDaemon(child, 300)).toBeUndefined();
  });
});

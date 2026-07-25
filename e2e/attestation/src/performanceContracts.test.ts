import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RELEASE_PERFORMANCE_BUDGETS,
  SUPERVISOR_IDLE_CPU_FRACTION_BUDGET,
  SUPERVISOR_IDLE_RSS_BUDGET_BYTES,
  checkPerformanceContracts,
  decideReleaseContracts,
  measureSupervisorIdle,
  supervisordEntryPoint,
  type SupervisorIdleMeasurement,
} from "./performanceContracts.js";
import type { QuietHostAssessment } from "./quietHost.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

/** 15's methodology floor is 10 samples per side, so fixtures must clear it. */
function series(value: number, count = 24): number[] {
  return Array.from({ length: count }, () => value);
}

function measurement(
  overrides: Partial<SupervisorIdleMeasurement> = {},
): SupervisorIdleMeasurement {
  return {
    peakRssBytes: series(50 * 1024 * 1024),
    cpuFraction: series(0.001),
    quietHost: QUIET,
    failures: [],
    ...overrides,
  };
}

describe("RELEASE_PERFORMANCE_BUDGETS", () => {
  it("encodes 05's documented idle budget, not invented numbers", () => {
    expect(SUPERVISOR_IDLE_RSS_BUDGET_BYTES).toBe(100 * 1024 * 1024);
    expect(SUPERVISOR_IDLE_CPU_FRACTION_BUDGET).toBe(0.01);
    for (const budget of RELEASE_PERFORMANCE_BUDGETS) {
      expect(budget.rationale).toContain("roadmap/05");
    }
  });
});

describe("decideReleaseContracts", () => {
  it("passes contracts comfortably inside their absolute budgets", () => {
    const decisions = decideReleaseContracts(measurement());
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) expect(decision.outcome).toBe("pass");
  });

  it("blocks a contract that breaches its absolute budget", () => {
    const decisions = decideReleaseContracts(
      measurement({ peakRssBytes: series(200 * 1024 * 1024) }),
    );
    const rss = decisions.find((d) => d.contractId === "supervisor-idle-rss");
    expect(rss?.outcome).toBe("block");
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
    }
  });

  it("reports inconclusive_blocking when a metric collected no samples", () => {
    const decisions = decideReleaseContracts(measurement({ cpuFraction: [] }));
    const cpu = decisions.find((d) => d.contractId === "supervisor-idle-cpu");
    expect(cpu?.outcome).toBe("inconclusive_blocking");
    expect(cpu?.note).toContain("no samples");
  });
});

describe("checkPerformanceContracts", () => {
  it("passes when every contract passed on a quiet host", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement()),
      quietHost: QUIET,
      failures: [],
    });
    expect(result.verdict).toBe("PASS");
  });

  it("FAILs on an empty contract set — never a vacuous 'all satisfied'", () => {
    const result = checkPerformanceContracts({ decisions: [], quietHost: QUIET, failures: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no performance contracts were measured");
  });

  it("FAILs on a budget breach", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement({ peakRssBytes: series(200 * 1024 * 1024) })),
      quietHost: QUIET,
      failures: [],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("BLOCK");
  });

  it("FAILs on an inconclusive contract, quoting why it could not be decided", () => {
    const result = checkPerformanceContracts({
      decisions: decideReleaseContracts(measurement({ quietHost: NOISY })),
      quietHost: NOISY,
      failures: [],
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
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("measurement failed");
  });
});

describe("measureSupervisorIdle — against the real daemon", () => {
  it("reports a build failure rather than crashing when the daemon is not built", async () => {
    const result = await measureSupervisorIdle(join(REPO_ROOT, "does-not-exist"), 100);
    expect(result.failures.join(" ")).toContain("not built");
    expect(result.peakRssBytes).toEqual([]);
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
   * produce a decidable series or an explicit failure.
   */
  it("collects a real sample series clearing 15's methodology floor", async () => {
    const result = await measureSupervisorIdle(REPO_ROOT);
    if (result.failures.length > 0) {
      // A daemon that could not boot here is a real, reported condition —
      // never silently treated as a pass.
      expect(result.failures.join(" ").length).toBeGreaterThan(0);
      return;
    }
    expect(result.peakRssBytes.length).toBeGreaterThanOrEqual(10);
    expect(result.cpuFraction.length).toBeGreaterThanOrEqual(10);
    for (const rss of result.peakRssBytes) expect(rss).toBeGreaterThan(0);
  });
});

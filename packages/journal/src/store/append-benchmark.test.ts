import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { measureAppendLatencies, percentile, summarizeLatencies } from "./append-benchmark.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";

/**
 * roadmap/04-journal-idempotency-leases.md exit criterion 9: "Append p50
 * latency documented with a CI regression gate." This test IS the CI
 * regression gate — it runs as part of the normal `vitest run` (wired into
 * CI's existing "test" job, `.github/workflows/ci.yml`, which already runs
 * `npm test` = `vitest run --coverage`; see this phase's evidence README
 * for confirmation this worker did NOT need to touch CI YAML).
 *
 * THRESHOLD (documented, deliberately generous): roadmap/04's own §Risks
 * note flags that "fsync semantics differ on WSL2 9p mounts" — this
 * repo's own dev environment IS WSL2 (see docs/engine-baseline.md) — so a
 * tight threshold tuned to one fast local disk would make this gate flaky
 * across contributors' machines and CI runners with different storage
 * backends. `P50_THRESHOLD_MS` is set generously above what this worker
 * observed locally (see docs/evidence/phase-04/exit-criteria-append-
 * benchmark.txt for the actual measured p50 over 1000 real appends) so
 * this gate only fires on a genuine multi-x regression, not routine
 * machine-to-machine variance.
 */
const P50_THRESHOLD_MS = 100;
const BENCHMARK_COUNT = 300;

const dirsToClean: string[] = [];

function freshConfig(): JournalStoreConfig {
  const journalDir = mkdtempSync(join(tmpdir(), "eo-journal-benchmark-"));
  dirsToClean.push(journalDir);
  return resolveStoreConfig({ journalDir });
}

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
});

describe("percentile / summarizeLatencies — pure math", () => {
  it("computes the nearest-rank percentile without mutating the input array", () => {
    const values = [5, 1, 4, 2, 3];
    const copy = [...values];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 100)).toBe(5);
    expect(percentile(values, 0)).toBe(1);
    expect(values).toEqual(copy);
  });

  it("throws on an empty sample rather than returning a misleading value", () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => summarizeLatencies([])).toThrow(RangeError);
  });

  it("summarizes count/p50/p90/p99/mean/min/max correctly for a known sample", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const stats = summarizeLatencies(values);
    expect(stats.count).toBe(10);
    expect(stats.p50Ms).toBe(5);
    expect(stats.minMs).toBe(1);
    expect(stats.maxMs).toBe(10);
    expect(stats.meanMs).toBeCloseTo(5.5, 5);
  });
});

describe("measureAppendLatencies — real filesystem", () => {
  it("returns exactly `count` non-negative latency samples, in call order, for real appends", async () => {
    const config = freshConfig();
    const latencies = await measureAppendLatencies(config, 10);
    expect(latencies).toHaveLength(10);
    for (const latency of latencies) {
      expect(latency).toBeGreaterThanOrEqual(0);
    }
  });
});

describe(`REGRESSION GATE: append p50 latency over ${String(BENCHMARK_COUNT)} real appends stays under a generous documented threshold`, () => {
  it(`p50 < ${String(P50_THRESHOLD_MS)}ms (see file-level doc comment for why this threshold is deliberately generous)`, async () => {
    const config = freshConfig();
    const latencies = await measureAppendLatencies(config, BENCHMARK_COUNT);
    const stats = summarizeLatencies(latencies);

    expect(
      stats.p50Ms,
      `p50 append latency ${stats.p50Ms.toFixed(3)}ms exceeded the ${String(P50_THRESHOLD_MS)}ms regression-gate threshold (full stats: ${JSON.stringify(stats)})`,
    ).toBeLessThan(P50_THRESHOLD_MS);
  }, 30_000);
});

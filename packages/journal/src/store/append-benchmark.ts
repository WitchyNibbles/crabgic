/**
 * Append p50 latency benchmark — roadmap/04-journal-idempotency-leases.md
 * work item 2: "measure p50 append latency"; exit criterion 9: "Append p50
 * latency documented with a CI regression gate — evidence: benchmark
 * output committed, gate wired into CI."
 */

import { appendEntry } from "./append-entry.js";
import type { JournalStoreConfig } from "./store-config.js";

export interface LatencyStats {
  readonly count: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/** Performs `count` sequential REAL appends (real fs, real fsync — never mocked) against `config`, returning each call's wall-clock latency in milliseconds, in call order. */
export async function measureAppendLatencies(
  config: JournalStoreConfig,
  count: number,
): Promise<number[]> {
  const latencies: number[] = [];
  for (let i = 0; i < count; i++) {
    const startedAt = performance.now();

    await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: `benchmark-entry-${String(i)}` },
    });
    latencies.push(performance.now() - startedAt);
  }
  return latencies;
}

/** Nearest-rank percentile (`p` in `[0, 100]`) over `values`, which need not be pre-sorted — this function sorts a copy, never mutating the input (this repo's immutability convention). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new RangeError("journal: cannot compute a percentile of an empty sample");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)]!;
}

/** Summarizes a latency sample (milliseconds) into the stats this exit criterion's evidence reports. */
export function summarizeLatencies(values: readonly number[]): LatencyStats {
  if (values.length === 0) {
    throw new RangeError("journal: cannot summarize an empty latency sample");
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    count: values.length,
    p50Ms: percentile(values, 50),
    p90Ms: percentile(values, 90),
    p99Ms: percentile(values, 99),
    meanMs: sum / values.length,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}

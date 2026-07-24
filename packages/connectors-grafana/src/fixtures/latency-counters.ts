/**
 * Latency/throughput counters — roadmap/20-grafana-adapters.md §Interfaces
 * produced: "Latency/throughput counters — consumed by 21 work item 6,
 * captured into 14's `EvidenceRecord` stream; available to, but not
 * contractually consumed by, 15." A minimal, dependency-free recorder:
 * per-operation call count, total/average/max duration — the raw material
 * 21 wraps into an `EvidenceRecord.artifactDigests`-referenced artifact,
 * never a claim this package itself emits an `EvidenceRecord` (that
 * remains 14's own responsibility).
 */
export interface GrafanaLatencyStat {
  readonly operation: string;
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly maxMs: number;
}

export interface GrafanaLatencyCounters {
  record(operation: string, durationMs: number): void;
  snapshot(): readonly GrafanaLatencyStat[];
  reset(): void;
}

export function createGrafanaLatencyCounters(): GrafanaLatencyCounters {
  const totals = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  return {
    record(operation, durationMs) {
      const existing = totals.get(operation) ?? { count: 0, totalMs: 0, maxMs: 0 };
      totals.set(operation, {
        count: existing.count + 1,
        totalMs: existing.totalMs + durationMs,
        maxMs: Math.max(existing.maxMs, durationMs),
      });
    },
    snapshot() {
      return [...totals.entries()]
        .map(([operation, stat]) => ({
          operation,
          count: stat.count,
          totalMs: stat.totalMs,
          avgMs: stat.totalMs / stat.count,
          maxMs: stat.maxMs,
        }))
        .sort((a, b) => a.operation.localeCompare(b.operation));
    },
    reset() {
      totals.clear();
    },
  };
}

/** Times `fn` and records its duration under `operation` — the one call site production/test code needs, so nobody hand-computes `Date.now()` deltas ad hoc per call site. */
export async function measureGrafanaOperation<T>(
  counters: GrafanaLatencyCounters,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    counters.record(operation, performance.now() - start);
  }
}

/**
 * Drift debounce — roadmap/21 §Risks & open questions: "Drift job hits live
 * systems on a schedule: transient provider flakiness could masquerade as
 * drift. Mitigation: require repeated failing runs before emitting a
 * `DriftProposal` (debounce), not a single sample." Work item 5's
 * failing-first case is a SINGLE bumped-fixture run producing a red
 * check — this tracker's `threshold` defaults to requiring exactly that
 * single run's OWN caller to decide (a threshold of 1 = no debounce), but
 * the drift-CI job (`./run-drift-ci.ts`) wires a >1 threshold in practice,
 * per the mitigation above.
 */
export const DEFAULT_DRIFT_DEBOUNCE_THRESHOLD = 2;

export interface DriftDebounceOutcome {
  readonly shouldEmit: boolean;
  readonly consecutiveFailures: number;
}

/** Persistable debounce state — one consecutive-failure counter per drift-comparison key. */
export type DriftDebounceState = Readonly<Record<string, number>>;

export class DriftDebounceTracker {
  private counts: Record<string, number>;

  constructor(
    private readonly threshold: number = DEFAULT_DRIFT_DEBOUNCE_THRESHOLD,
    initial: DriftDebounceState = {},
  ) {
    if (threshold < 1) {
      throw new RangeError(
        `DriftDebounceTracker: threshold must be >= 1, got ${String(threshold)}`,
      );
    }
    this.counts = { ...initial };
  }

  /** Records one comparison run's outcome for `key`; a non-drifted run resets the counter to 0. */
  recordRun(key: string, drifted: boolean): DriftDebounceOutcome {
    if (!drifted) {
      this.counts[key] = 0;
      return { shouldEmit: false, consecutiveFailures: 0 };
    }
    const next = (this.counts[key] ?? 0) + 1;
    this.counts[key] = next;
    return { shouldEmit: next >= this.threshold, consecutiveFailures: next };
  }

  /** Snapshot of current per-key counters, for persistence across scheduled CI runs. */
  dump(): DriftDebounceState {
    return { ...this.counts };
  }
}

/**
 * Heartbeat-paced resource scheduler — roadmap/05-supervisor-daemon.md
 * §Idle resource budget: "5 s heartbeats." Samples `../idle-budget/
 * resource-probe.js` on a real, `unref()`'d `setInterval` cadence — NEVER
 * a busy/always-polling loop (see the naive stub this replaced,
 * docs/evidence/phase-05/wi6-heartbeat-scheduler-failing.txt, which
 * consumed ~117% of one core over a 300ms window against the <1% budget
 * by polling via a tight `setImmediate` recursion instead of pacing).
 * `unref()` also means this scheduler alone never keeps the Node process
 * event loop alive — matching this phase's "idle footprint" framing.
 */
import { sampleResourceUsage, type ResourceSample } from "./resource-probe.js";

export const HEARTBEAT_INTERVAL_MS = 5_000;

export interface HeartbeatScheduler {
  start(): void;
  stop(): void;
  readonly samples: readonly ResourceSample[];
}

export interface HeartbeatSchedulerOptions {
  readonly intervalMs?: number;
  readonly sample?: () => ResourceSample;
  readonly onSample?: (sample: ResourceSample) => void;
}

export function createHeartbeatScheduler(
  options: HeartbeatSchedulerOptions = {},
): HeartbeatScheduler {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const sampleFn = options.sample ?? sampleResourceUsage;
  const samples: ResourceSample[] = [];
  let timer: NodeJS.Timeout | undefined;

  function tick(): void {
    const sample = sampleFn();
    samples.push(sample);
    options.onSample?.(sample);
  }

  return {
    start(): void {
      if (timer !== undefined) return;
      tick(); // one immediate sample so callers have data before the first interval elapses
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    get samples(): readonly ResourceSample[] {
      return samples;
    },
  };
}

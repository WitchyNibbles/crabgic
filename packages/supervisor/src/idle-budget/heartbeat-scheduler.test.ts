/**
 * roadmap/05-supervisor-daemon.md work item 6 failing-first target: "an
 * always-polling implementation exceeds the budget against a naive
 * always-polling implementation before the heartbeat-paced version
 * replaces it."
 */
import { describe, expect, it } from "vitest";
import { createHeartbeatScheduler } from "./heartbeat-scheduler.js";
import { cpuFractionBetween, sampleResourceUsage } from "./resource-probe.js";

const CPU_BUDGET_FRACTION = 0.01; // <1% of one core

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("heartbeat scheduler — idle CPU budget", () => {
  it("stays under <1% of one core while idle over a sustained window, paced (not always-polling)", async () => {
    const before = sampleResourceUsage();
    const scheduler = createHeartbeatScheduler({ intervalMs: 5_000 });
    scheduler.start();

    // A 2s window (was 300ms) so the fixed one-off startup/sampling CPU cost
    // (~3-5ms: scheduler construction + the immediate sample) amortizes well
    // below the 1%-of-one-core budget — 1% of 300ms is only 3ms, smaller than
    // that fixed cost, so the short window sat on the boundary and flaked when
    // this test ran alongside the full parallel suite (the paced idle process
    // itself uses only a few ms of CPU regardless of window length; the
    // companion idle-budget.integration.test.ts already measures over 1500ms
    // for the same reason). An always-polling implementation would burn ~2s of
    // CPU over this window (fraction ~1.0), so the discriminating power against
    // the failing-first naive variant is strengthened, not weakened.
    await wait(2_000);

    scheduler.stop();
    const after = sampleResourceUsage();

    const cpuFraction = cpuFractionBetween(before, after);
    expect(cpuFraction).toBeLessThan(CPU_BUDGET_FRACTION);
  }, 20_000);
});

describe("heartbeat scheduler — lifecycle mechanics", () => {
  it("invokes onSample and accumulates .samples on each tick, using an injectable sample function", () => {
    const samples: number[] = [];
    let counter = 0;
    const scheduler = createHeartbeatScheduler({
      intervalMs: 5_000,
      sample: () => ({ rssBytes: 0, cpuUserMicros: counter++, cpuSystemMicros: 0, sampledAtMs: 0 }),
      onSample: (sample) => samples.push(sample.cpuUserMicros),
    });
    scheduler.start();
    expect(samples).toEqual([0]);
    expect(scheduler.samples).toHaveLength(1);
    scheduler.stop();
  });

  it("start() is idempotent — calling it twice does not create a second timer", () => {
    const scheduler = createHeartbeatScheduler({ intervalMs: 5_000 });
    scheduler.start();
    scheduler.start();
    expect(scheduler.samples).toHaveLength(1); // only the one immediate sample from the first start()
    scheduler.stop();
  });

  it("stop() before start() is a safe no-op", () => {
    const scheduler = createHeartbeatScheduler({ intervalMs: 5_000 });
    expect(() => scheduler.stop()).not.toThrow();
    expect(scheduler.samples).toEqual([]);
  });

  it("stop() is idempotent — calling it twice does not throw", () => {
    const scheduler = createHeartbeatScheduler({ intervalMs: 5_000 });
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });
});

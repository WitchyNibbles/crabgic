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

    await wait(300); // sustained no-op window

    scheduler.stop();
    const after = sampleResourceUsage();

    const cpuFraction = cpuFractionBetween(before, after);
    expect(cpuFraction).toBeLessThan(CPU_BUDGET_FRACTION);
  });
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

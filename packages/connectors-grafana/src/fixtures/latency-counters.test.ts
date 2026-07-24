import { describe, expect, it } from "vitest";
import { createGrafanaLatencyCounters, measureGrafanaOperation } from "./latency-counters.js";

describe("createGrafanaLatencyCounters", () => {
  it("records count/total/avg/max per operation", () => {
    const counters = createGrafanaLatencyCounters();
    counters.record("list:folder", 10);
    counters.record("list:folder", 30);
    counters.record("get:dashboard", 5);

    const snapshot = counters.snapshot();
    const folderStat = snapshot.find((s) => s.operation === "list:folder");
    expect(folderStat).toEqual({
      operation: "list:folder",
      count: 2,
      totalMs: 40,
      avgMs: 20,
      maxMs: 30,
    });
    const dashboardStat = snapshot.find((s) => s.operation === "get:dashboard");
    expect(dashboardStat?.count).toBe(1);
  });

  it("snapshot is sorted deterministically by operation name", () => {
    const counters = createGrafanaLatencyCounters();
    counters.record("z-op", 1);
    counters.record("a-op", 1);
    expect(counters.snapshot().map((s) => s.operation)).toEqual(["a-op", "z-op"]);
  });

  it("reset clears all recorded counters", () => {
    const counters = createGrafanaLatencyCounters();
    counters.record("op", 1);
    counters.reset();
    expect(counters.snapshot()).toEqual([]);
  });

  it("measureGrafanaOperation records the duration of an async call, even on failure", async () => {
    const counters = createGrafanaLatencyCounters();
    await measureGrafanaOperation(counters, "op-ok", async () => "done");
    await expect(
      measureGrafanaOperation(counters, "op-fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const snapshot = counters.snapshot();
    expect(snapshot.find((s) => s.operation === "op-ok")?.count).toBe(1);
    expect(snapshot.find((s) => s.operation === "op-fail")?.count).toBe(1);
  });
});

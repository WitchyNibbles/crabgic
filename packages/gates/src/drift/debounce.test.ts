import { describe, expect, it } from "vitest";
import { DriftDebounceTracker } from "./debounce.js";

describe("DriftDebounceTracker — transient flakiness must not masquerade as drift", () => {
  it("does NOT emit on the first failing run when threshold is 2 (the default)", () => {
    const tracker = new DriftDebounceTracker();
    const outcome = tracker.recordRun("jira:3.0.0", true);
    expect(outcome).toEqual({ shouldEmit: false, consecutiveFailures: 1 });
  });

  it("emits once the SAME key fails for `threshold` consecutive runs", () => {
    const tracker = new DriftDebounceTracker(2);
    expect(tracker.recordRun("jira:3.0.0", true).shouldEmit).toBe(false);
    expect(tracker.recordRun("jira:3.0.0", true).shouldEmit).toBe(true);
  });

  it("a passing run in between resets the counter — never accumulates across a healthy run", () => {
    const tracker = new DriftDebounceTracker(2);
    expect(tracker.recordRun("jira:3.0.0", true).consecutiveFailures).toBe(1);
    expect(tracker.recordRun("jira:3.0.0", false).consecutiveFailures).toBe(0);
    expect(tracker.recordRun("jira:3.0.0", true).shouldEmit).toBe(false);
  });

  it("tracks each key's counter independently", () => {
    const tracker = new DriftDebounceTracker(2);
    tracker.recordRun("jira:3.0.0", true);
    tracker.recordRun("jira:3.0.0", true);
    const grafanaOutcome = tracker.recordRun("grafana:11.0.0", true);
    expect(grafanaOutcome).toEqual({ shouldEmit: false, consecutiveFailures: 1 });
  });

  it("threshold=1 emits immediately (no debounce) — a caller opting out explicitly", () => {
    const tracker = new DriftDebounceTracker(1);
    expect(tracker.recordRun("jira:3.0.0", true).shouldEmit).toBe(true);
  });

  it("rejects a threshold below 1", () => {
    expect(() => new DriftDebounceTracker(0)).toThrow(RangeError);
  });

  it("dump()/hydration round-trips state across a simulated new process", () => {
    const first = new DriftDebounceTracker(2);
    first.recordRun("jira:3.0.0", true);
    const state = first.dump();

    const second = new DriftDebounceTracker(2, state);
    expect(second.recordRun("jira:3.0.0", true).shouldEmit).toBe(true);
  });
});

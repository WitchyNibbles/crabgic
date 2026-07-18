/**
 * roadmap/05-supervisor-daemon.md work item 5 failing-first target: "a
 * slow-subscriber fixture stalls the pipe against a naive unbounded queue
 * before the backpressured buffer replaces it."
 */
import { describe, expect, it } from "vitest";
import { createRingBuffer } from "./ring-buffer.js";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "TIMED_OUT"> {
  return Promise.race([
    promise,
    new Promise<"TIMED_OUT">((resolve) => {
      const t = setTimeout(() => resolve("TIMED_OUT"), ms);
      t.unref?.();
    }),
  ]);
}

describe("ring buffer — a slow subscriber must never stall the worker pipe", () => {
  it("push() completes quickly even when one subscriber never polls/drains", async () => {
    const buffer = createRingBuffer();
    const fast = buffer.subscribe();
    const slow = buffer.subscribe(); // deliberately never polled below — the stalling subscriber

    let received = 0;
    let lastResult: unknown;
    for (let i = 0; i < 200; i++) {
      lastResult = await withTimeout(buffer.push(`line-${String(i)}`), 300);
      if (lastResult === "TIMED_OUT") break;
      received += fast.poll().length; // an actively-draining, fast subscriber
    }

    expect(lastResult).not.toBe("TIMED_OUT");
    // Sanity: the fast subscriber actually received data (proves push()
    // was doing real work, not a no-op).
    expect(received).toBeGreaterThan(0);
    void slow;
  }, 10_000);
});

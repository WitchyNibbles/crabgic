import { describe, expect, it } from "vitest";
import { TimestampSchema } from "@eo/contracts";
import { createClockProvider, createClockProviderState, drawTimestamp } from "./clock-provider.js";

/**
 * Deterministic clock provider — roadmap/02-contracts-and-schemas.md work
 * item 10: "a clock provider producing TimestampSchema-valid ISO strings
 * from a fixed epoch + step." Failing-first (TDD): written before
 * `clock-provider.ts` exists.
 */
describe("drawTimestamp (pure core)", () => {
  it("produces a TimestampSchema-valid ISO string", () => {
    const state = createClockProviderState(Date.UTC(2026, 0, 1), 1000);
    const { timestamp } = drawTimestamp(state);
    expect(TimestampSchema.safeParse(timestamp).success).toBe(true);
  });

  it("is deterministic: same epoch + step + tick position always yields the same timestamp", () => {
    const a = drawTimestamp(createClockProviderState(1_700_000_000_000, 500));
    const b = drawTimestamp(createClockProviderState(1_700_000_000_000, 500));
    expect(a.timestamp).toBe(b.timestamp);
  });

  it("advances by exactly one step per draw without mutating the input state", () => {
    const state = createClockProviderState(0, 1000);
    const frozenCopy = { ...state };
    const first = drawTimestamp(state);
    const second = drawTimestamp(first.state);
    expect(state).toEqual(frozenCopy);
    expect(new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime()).toBe(1000);
  });

  it("starts exactly at the fixed epoch on the first draw", () => {
    const epochMs = Date.UTC(2026, 6, 15, 12, 0, 0);
    const { timestamp } = drawTimestamp(createClockProviderState(epochMs, 1000));
    expect(timestamp).toBe(new Date(epochMs).toISOString());
  });
});

describe("createClockProvider (closure convenience factory)", () => {
  it("documented closure-counter factory: .next() returns TimestampSchema-valid, monotonically-advancing timestamps", () => {
    const clock = createClockProvider(0, 1000);
    const first = clock.next();
    const second = clock.next();
    expect(TimestampSchema.safeParse(first).success).toBe(true);
    expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
  });

  it("is deterministic across separate provider instances sharing epoch + step", () => {
    const clockA = createClockProvider(1_800_000_000_000, 250);
    const clockB = createClockProvider(1_800_000_000_000, 250);
    expect(clockA.next()).toBe(clockB.next());
    expect(clockA.next()).toBe(clockB.next());
  });

  it("defaults to a fixed epoch/step when called with no arguments (deterministic across runs)", () => {
    const clockA = createClockProvider();
    const clockB = createClockProvider();
    expect(clockA.next()).toBe(clockB.next());
  });
});

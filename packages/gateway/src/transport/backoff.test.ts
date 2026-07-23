import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeBackoffDelayMs, parseRetryAfterHeader } from "./backoff.js";

describe("computeBackoffDelayMs", () => {
  it("honors an explicit Retry-After value, capped at maxMs", () => {
    const delay = computeBackoffDelayMs(1, 5000, { baseMs: 200, maxMs: 3000 });
    expect(delay).toBe(3000);
  });

  it("honors a Retry-After value under the cap verbatim", () => {
    const delay = computeBackoffDelayMs(1, 1000, { baseMs: 200, maxMs: 30_000 });
    expect(delay).toBe(1000);
  });

  it("clamps a negative Retry-After to zero", () => {
    const delay = computeBackoffDelayMs(1, -500, { baseMs: 200, maxMs: 30_000 });
    expect(delay).toBe(0);
  });

  it("falls back to jittered exponential backoff when no Retry-After is given", () => {
    const delay = computeBackoffDelayMs(3, undefined, {
      baseMs: 100,
      maxMs: 30_000,
      random: () => 0.5,
    });
    // attempt 3 => exponential = 100 * 2^2 = 400; delay = 0.5 * 400 = 200
    expect(delay).toBe(200);
  });

  it("caps the exponential curve at maxMs even for a high attempt count", () => {
    const delay = computeBackoffDelayMs(20, undefined, {
      baseMs: 100,
      maxMs: 1000,
      random: () => 1,
    });
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it("property: delay is always within [0, maxMs] across random attempts/jitter", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (attempt, jitter) => {
          const delay = computeBackoffDelayMs(attempt, undefined, {
            baseMs: 200,
            maxMs: 30_000,
            random: () => jitter,
          });
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(30_000);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("parseRetryAfterHeader", () => {
  it("parses a numeric seconds value", () => {
    expect(parseRetryAfterHeader("5")).toBe(5000);
  });

  it("parses an HTTP-date value relative to now", () => {
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    expect(parseRetryAfterHeader("Thu, 01 Jan 2026 00:00:02 GMT", now)).toBe(2000);
  });

  it("returns 0 for a past HTTP-date", () => {
    const now = () => new Date("2026-01-01T00:00:10.000Z");
    expect(parseRetryAfterHeader("Thu, 01 Jan 2026 00:00:00 GMT", now)).toBe(0);
  });

  it("returns undefined for null", () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseRetryAfterHeader("   ")).toBeUndefined();
  });

  it("returns undefined for an unparseable value", () => {
    expect(parseRetryAfterHeader("not-a-value")).toBeUndefined();
  });
});

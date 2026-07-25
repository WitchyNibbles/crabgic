import { describe, expect, it } from "vitest";
import { assertValidPct } from "./types.js";

describe("assertValidPct", () => {
  it("accepts a finite percentage in [0,100]", () => {
    expect(() => assertValidPct(0, "x")).not.toThrow();
    expect(() => assertValidPct(100, "x")).not.toThrow();
    expect(() => assertValidPct(42.5, "x")).not.toThrow();
  });

  it("rejects NaN, out-of-range, and non-finite values", () => {
    expect(() => assertValidPct(Number.NaN, "x")).toThrow(RangeError);
    expect(() => assertValidPct(-1, "x")).toThrow(RangeError);
    expect(() => assertValidPct(101, "x")).toThrow(RangeError);
    expect(() => assertValidPct(Number.POSITIVE_INFINITY, "x")).toThrow(RangeError);
  });
});

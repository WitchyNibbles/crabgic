import { describe, expect, it } from "vitest";
import { cpuFractionBetween, sampleResourceUsage } from "./resource-probe.js";

describe("sampleResourceUsage", () => {
  it("returns a plausible, self-contained sample of this process alone", () => {
    const sample = sampleResourceUsage();
    expect(sample.rssBytes).toBeGreaterThan(0);
    expect(sample.cpuUserMicros).toBeGreaterThanOrEqual(0);
    expect(sample.cpuSystemMicros).toBeGreaterThanOrEqual(0);
    expect(sample.sampledAtMs).toBeGreaterThan(0);
  });
});

describe("cpuFractionBetween", () => {
  it("computes a fraction between two real samples", () => {
    const previous = sampleResourceUsage();
    const current = {
      ...previous,
      cpuUserMicros: previous.cpuUserMicros + 1000,
      sampledAtMs: previous.sampledAtMs + 1000,
    };
    const fraction = cpuFractionBetween(previous, current);
    expect(fraction).toBeCloseTo(0.001, 5);
  });

  it("returns 0 when the wall-clock delta is zero (same instant)", () => {
    const sample = sampleResourceUsage();
    expect(cpuFractionBetween(sample, sample)).toBe(0);
  });

  it("returns 0 when the wall-clock delta is negative (out-of-order samples)", () => {
    const previous = sampleResourceUsage();
    const current = { ...previous, sampledAtMs: previous.sampledAtMs - 1000 };
    expect(cpuFractionBetween(previous, current)).toBe(0);
  });
});

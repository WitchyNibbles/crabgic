import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOST_THRESHOLDS,
  assessQuietHost,
  computeIdleFraction,
  parseLoadAvg,
  parseProcStat,
  probeQuietHost,
} from "./quietHost.js";

const PROC_STAT = [
  "cpu  100 0 50 800 40 0 10 0 0 0",
  "cpu0 50 0 25 400 20 0 5 0 0 0",
  "intr 12345",
].join("\n");

describe("parseProcStat", () => {
  it("sums idle and iowait as non-working time, and every field as total", () => {
    const parsed = parseProcStat(PROC_STAT);
    expect(parsed.idle).toBe(840); // idle 800 + iowait 40
    expect(parsed.total).toBe(1000);
  });

  it("throws when the aggregate cpu line is absent rather than guessing", () => {
    expect(() => parseProcStat("intr 1\nctxt 2")).toThrow(/aggregate cpu line/);
  });
});

describe("parseLoadAvg", () => {
  it("reads the 1-minute load average", () => {
    expect(parseLoadAvg("0.42 0.31 0.28 1/523 91234")).toBeCloseTo(0.42);
  });

  it("throws on unparseable content rather than defaulting to zero", () => {
    expect(() => parseLoadAvg("not a load average")).toThrow(/unparseable/);
  });
});

describe("computeIdleFraction", () => {
  it("computes idle time as a fraction of the interval", () => {
    const before = { idle: 100, total: 200 };
    const after = { idle: 190, total: 300 };
    expect(computeIdleFraction(before, after)).toBeCloseTo(0.9);
  });

  /** A zero-length interval carries no information; treating it as idle would certify any host. */
  it("reports zero idle for a zero-length interval rather than fully idle", () => {
    expect(computeIdleFraction({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBe(0);
  });
});

describe("assessQuietHost", () => {
  it("passes a genuinely quiet host", () => {
    const result = assessQuietHost(0.2, 8, 0.97);
    expect(result.quiet).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.loadPerCore).toBeCloseTo(0.025);
  });

  it("FAILs a host under heavy load", () => {
    const result = assessQuietHost(16, 8, 0.95);
    expect(result.quiet).toBe(false);
    expect(result.reasons.join(" ")).toContain("per core");
  });

  it("FAILs a host that was busy across the measured interval", () => {
    const result = assessQuietHost(0.1, 8, 0.4);
    expect(result.quiet).toBe(false);
    expect(result.reasons.join(" ")).toContain("idle across the measured interval");
  });

  it("normalises load by core count, so a big machine is not penalised", () => {
    // The same raw load average is quiet on 64 cores and busy on 1.
    expect(assessQuietHost(4, 64, 0.95).quiet).toBe(true);
    expect(assessQuietHost(4, 1, 0.95).quiet).toBe(false);
  });

  it("treats a zero core count as a single core rather than dividing by zero", () => {
    const result = assessQuietHost(4, 0, 0.95);
    expect(Number.isFinite(result.loadPerCore)).toBe(true);
    expect(result.quiet).toBe(false);
  });

  it("honours caller-supplied thresholds", () => {
    expect(assessQuietHost(0.9, 1, 0.95, { maxLoadPerCore: 1, minIdleFraction: 0.5 }).quiet).toBe(
      true,
    );
    expect(assessQuietHost(0.9, 1, 0.95, DEFAULT_QUIET_HOST_THRESHOLDS).quiet).toBe(false);
  });
});

describe("probeQuietHost — against the real host", () => {
  it("opens and closes a real measurement interval", async () => {
    const sampler = await probeQuietHost();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const assessment = await sampler.finish();

    // Asserts shape, not verdict: whether THIS host is quiet is a property
    // of the machine the suite runs on, not of the code under test.
    expect(typeof assessment.quiet).toBe("boolean");
    expect(assessment.idleFraction).toBeGreaterThanOrEqual(0);
    expect(assessment.idleFraction).toBeLessThanOrEqual(1);
    expect(assessment.loadPerCore).toBeGreaterThanOrEqual(0);
  });
});

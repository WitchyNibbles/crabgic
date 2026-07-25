import { describe, expect, it } from "vitest";
import { parseIstanbulSummary } from "./istanbul-adapter.js";

describe("parseIstanbulSummary — per-adapter parser fixture at a known percentage", () => {
  it("reads .total.lines.pct / .total.branches.pct verbatim", () => {
    const fixture = {
      total: {
        lines: { total: 100, covered: 84, skipped: 0, pct: 84 },
        branches: { total: 50, covered: 41, skipped: 0, pct: 82 },
      },
    };
    const summary = parseIstanbulSummary(fixture);
    expect(summary.linePct).toBe(84);
    expect(summary.branchPct).toBe(82);
    expect(summary.toolchain).toBe("istanbul");
  });

  it("treats a literal 'Unknown' pct (0 total lines) as 100%", () => {
    const fixture = {
      total: {
        lines: { total: 0, covered: 0, skipped: 0, pct: "Unknown" },
        branches: { total: 0, covered: 0, skipped: 0, pct: "Unknown" },
      },
    };
    const summary = parseIstanbulSummary(fixture);
    expect(summary.linePct).toBe(100);
    expect(summary.branchPct).toBe(100);
  });

  it("rejects a malformed report (missing .total)", () => {
    expect(() => parseIstanbulSummary({ notTotal: {} })).toThrow();
  });
});

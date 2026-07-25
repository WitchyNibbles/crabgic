import { describe, expect, it } from "vitest";
import { parsePytestCovReport } from "./pytest-cov-adapter.js";

describe("parsePytestCovReport — per-adapter parser fixture at a known percentage", () => {
  it("reads totals.percent_covered and derives branch pct from covered/num branches", () => {
    const fixture = {
      totals: {
        covered_lines: 83,
        num_statements: 100,
        percent_covered: 83,
        covered_branches: 30,
        num_branches: 40,
      },
    };
    const summary = parsePytestCovReport(fixture);
    expect(summary.linePct).toBe(83);
    expect(summary.branchPct).toBe(75);
    expect(summary.toolchain).toBe("pytest-cov");
  });

  it("reports branchPct 100% when branch coverage was not configured (num_branches absent)", () => {
    const fixture = { totals: { covered_lines: 90, num_statements: 100, percent_covered: 90 } };
    const summary = parsePytestCovReport(fixture);
    expect(summary.branchPct).toBe(100);
  });

  it("rejects a malformed report", () => {
    expect(() => parsePytestCovReport({ nope: true })).toThrow();
  });
});

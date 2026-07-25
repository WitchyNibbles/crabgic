import { describe, expect, it } from "vitest";
import { parseLcovReport } from "./lcov-adapter.js";

const FIXTURE_AT_KNOWN_PCT = `
TN:
SF:src/example.ts
DA:1,1
DA:2,1
DA:3,1
DA:4,0
DA:5,1
BRDA:2,0,0,1
BRDA:2,0,1,0
BRDA:4,0,0,-
BRDA:4,0,1,3
end_of_record
`;

describe("parseLcovReport — per-adapter parser fixture at a known percentage", () => {
  it("computes line and branch percentages from DA:/BRDA: records", () => {
    const summary = parseLcovReport(FIXTURE_AT_KNOWN_PCT);
    // 5 DA lines, 4 hit -> 80%
    expect(summary.linePct).toBeCloseTo(80, 5);
    // 4 BRDA records, 2 taken (branch taken>0) -> 50%
    expect(summary.branchPct).toBeCloseTo(50, 5);
    expect(summary.toolchain).toBe("lcov");
  });

  it("reports 100% for both metrics on an empty report (nothing found, nothing missed)", () => {
    const summary = parseLcovReport("TN:\nSF:empty.ts\nend_of_record\n");
    expect(summary.linePct).toBe(100);
    expect(summary.branchPct).toBe(100);
  });

  it("reports 0% when every DA/BRDA record is unhit", () => {
    const summary = parseLcovReport("DA:1,0\nDA:2,0\nBRDA:1,0,0,-\n");
    expect(summary.linePct).toBe(0);
    expect(summary.branchPct).toBe(0);
  });
});

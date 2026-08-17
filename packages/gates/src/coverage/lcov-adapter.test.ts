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

/**
 * Owner ruling R6 — the per-line detail this adapter used to discard.
 * `docs/evidence/phase-14/README.md` named the discard as one of three things
 * missing for changed-line coverage.
 */
describe("parseLcovReport — per-line detail (owner ruling R6)", () => {
  it("returns each file's line hit counts, keyed by the SF: path", () => {
    const summary = parseLcovReport(
      ["SF:/repo/src/a.ts", "DA:1,3", "DA:2,0", "DA:7,1", "end_of_record"].join("\n"),
    );
    expect([...(summary.lines?.get("/repo/src/a.ts") ?? [])]).toStrictEqual([
      [1, 3],
      [2, 0],
      [7, 1],
    ]);
  });

  it("keeps files apart", () => {
    const summary = parseLcovReport(
      [
        "SF:src/a.ts",
        "DA:1,1",
        "end_of_record",
        "SF:src/b.ts",
        "DA:1,0",
        "end_of_record",
      ].join("\n"),
    );
    expect(summary.lines?.get("src/a.ts")?.get(1)).toBe(1);
    expect(summary.lines?.get("src/b.ts")?.get(1)).toBe(0);
  });

  /**
   * ⚠️ Some tools emit one section per test file. Replacing on a repeated `SF:`
   * would keep only the last section's hits, so a line one test exercised would
   * read as uncovered — a false refusal, but a false one either way.
   */
  it("MERGES repeated sections for the same path, summing hits rather than overwriting", () => {
    const summary = parseLcovReport(
      [
        "SF:src/a.ts",
        "DA:1,2",
        "DA:2,0",
        "end_of_record",
        "SF:src/a.ts",
        "DA:1,3",
        "DA:2,1",
        "end_of_record",
      ].join("\n"),
    );
    expect(summary.lines?.get("src/a.ts")?.get(1)).toBe(5);
    // The zero from the first section must not erase the hit from the second.
    expect(summary.lines?.get("src/a.ts")?.get(2)).toBe(1);
  });

  /**
   * An `SF:` with an empty path names no file. Its `DA:` records must attribute
   * to NOTHING — attributing them to whichever section was open before would
   * silently merge one file's coverage into another's.
   */
  it("drops the section on an empty SF: path rather than keeping the previous file open", () => {
    const summary = parseLcovReport(
      ["SF:src/a.ts", "DA:1,1", "SF:", "DA:2,1", "end_of_record"].join("\n"),
    );
    expect([...(summary.lines?.get("src/a.ts") ?? [])]).toStrictEqual([[1, 1]]);
    expect(summary.lines?.has("")).toBe(false);
    // Still counted in the AGGREGATE, exactly as before R6.
    expect(summary.linePct).toBe(100);
  });

  it("attributes no per-line entry to a DA: arriving before any SF:", () => {
    const summary = parseLcovReport(["DA:1,1", "SF:src/a.ts", "DA:2,1", "end_of_record"].join("\n"));
    expect([...(summary.lines?.get("src/a.ts") ?? [])]).toStrictEqual([[2, 1]]);
    // The orphan still counts toward the AGGREGATE, exactly as it always did.
    expect(summary.linePct).toBe(100);
  });

  it("does not carry a DA: past end_of_record into the next section", () => {
    const summary = parseLcovReport(
      ["SF:src/a.ts", "DA:1,1", "end_of_record", "DA:99,1", "SF:src/b.ts", "DA:2,1", "end_of_record"].join(
        "\n",
      ),
    );
    expect(summary.lines?.get("src/a.ts")?.has(99)).toBe(false);
    expect(summary.lines?.get("src/b.ts")?.has(99)).toBe(false);
  });

  /** The aggregate is the contract everything else already depends on; R6 must not move it. */
  it("leaves the aggregate percentages byte-for-byte unchanged", () => {
    const summary = parseLcovReport(
      ["SF:src/a.ts", "DA:1,1", "DA:2,0", "BRDA:1,0,0,1", "BRDA:1,0,1,-", "end_of_record"].join("\n"),
    );
    expect(summary.linePct).toBe(50);
    expect(summary.branchPct).toBe(50);
    expect(summary.toolchain).toBe("lcov");
  });
});

import { describe, expect, it } from "vitest";
import { parseGoCoverProfile } from "./go-cover-adapter.js";

describe("parseGoCoverProfile — per-adapter parser fixture at a known percentage", () => {
  it("computes statement-weighted coverage from mode+record lines", () => {
    const fixture = [
      "mode: set",
      "example.go:1.1,3.2 5 1",
      "example.go:4.1,6.2 5 0",
      "example.go:7.1,9.2 10 1",
    ].join("\n");
    const summary = parseGoCoverProfile(fixture);
    // hit: 5 + 10 = 15; total: 5+5+10 = 20 -> 75%
    expect(summary.linePct).toBeCloseTo(75, 5);
    // go cover has no distinct branch data — branchPct mirrors linePct.
    expect(summary.branchPct).toBe(summary.linePct);
    expect(summary.toolchain).toBe("go-cover");
  });

  it("reports 100% when the profile has no statement records", () => {
    const summary = parseGoCoverProfile("mode: atomic\n");
    expect(summary.linePct).toBe(100);
    expect(summary.branchPct).toBe(100);
  });

  it("ignores unparsable lines rather than throwing", () => {
    const summary = parseGoCoverProfile("mode: set\nnot a valid record line\nexample.go:1.1,2.2 4 1");
    expect(summary.linePct).toBe(100);
  });
});

/** Owner ruling R6 — per-line detail, derived from each record's line RANGE. */
describe("parseGoCoverProfile — per-line detail (owner ruling R6)", () => {
  it("attributes a block's count to every line in its range", () => {
    const summary = parseGoCoverProfile(
      ["mode: set", "pkg/a.go:3.10,6.2 2 1", "pkg/a.go:8.1,9.2 1 0"].join("\n"),
    );
    expect([...(summary.lines?.get("pkg/a.go") ?? [])]).toStrictEqual([
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
      [8, 0],
      [9, 0],
    ]);
  });

  /**
   * ⚠️ Go emits nested and overlapping blocks for inlined expressions. A later
   * zero-count block must not erase an earlier positive one, or a line that
   * genuinely ran would read as uncovered.
   */
  it("takes the MAXIMUM count on overlapping blocks rather than the last one", () => {
    const summary = parseGoCoverProfile(
      ["mode: set", "pkg/a.go:1.1,5.2 3 4", "pkg/a.go:2.1,3.2 1 0"].join("\n"),
    );
    expect(summary.lines?.get("pkg/a.go")?.get(2)).toBe(4);
    expect(summary.lines?.get("pkg/a.go")?.get(3)).toBe(4);
  });

  it("keeps packages apart and leaves the aggregate unchanged", () => {
    const summary = parseGoCoverProfile(
      ["mode: set", "pkg/a.go:1.1,2.2 1 1", "pkg/b.go:1.1,2.2 1 0"].join("\n"),
    );
    expect(summary.lines?.get("pkg/a.go")?.get(1)).toBe(1);
    expect(summary.lines?.get("pkg/b.go")?.get(1)).toBe(0);
    expect(summary.linePct).toBe(50);
    expect(summary.branchPct).toBe(50);
  });
});

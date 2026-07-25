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

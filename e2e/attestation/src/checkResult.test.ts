import { describe, expect, it } from "vitest";
import { buildCheckResult, digestArtifact, digestCheckResult } from "./checkResult.js";

describe("buildCheckResult", () => {
  it("derives PASS from an empty reason list", () => {
    const result = buildCheckResult([], ["all four docs tracked"]);
    expect(result.verdict).toBe("PASS");
    expect(result.reasons).toEqual([]);
    expect(result.details).toEqual(["all four docs tracked"]);
  });

  it("derives FAIL from any reason", () => {
    const result = buildCheckResult(["docs/upgrade-guide.md is not git-tracked."]);
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
  });

  it("copies its inputs so a caller's later mutation cannot rewrite a recorded verdict", () => {
    const reasons = ["first"];
    const result = buildCheckResult(reasons);
    reasons.push("smuggled in after the fact");
    expect(result.reasons).toEqual(["first"]);
  });

  it("upholds the PASS-iff-no-reasons invariant across every combination", () => {
    for (const reasons of [[], ["a"], ["a", "b"]]) {
      const result = buildCheckResult(reasons);
      expect(result.verdict === "PASS").toBe(result.reasons.length === 0);
    }
  });
});

describe("digestArtifact / digestCheckResult", () => {
  it("produces the sha256:-prefixed form EvidenceRecord.artifactDigests requires", () => {
    expect(digestArtifact("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic for identical content and distinct for different content", () => {
    expect(digestArtifact("same")).toBe(digestArtifact("same"));
    expect(digestArtifact("a")).not.toBe(digestArtifact("b"));
  });

  it("digests reasons and details separately, so a changed reason changes the record", () => {
    const passing = digestCheckResult(buildCheckResult([], ["d"]));
    const failing = digestCheckResult(buildCheckResult(["r"], ["d"]));
    expect(passing).toHaveLength(2);
    expect(failing[0]).not.toBe(passing[0]);
    // Details unchanged -> the details digest is stable across the two.
    expect(failing[1]).toBe(passing[1]);
  });
});

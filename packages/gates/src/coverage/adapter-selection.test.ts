import { describe, expect, it } from "vitest";
import { buildStackEvidence } from "@crabgic/testkit";
import { ecosystemsPresent, selectCoverageAdapter } from "./adapter-selection.js";

function evidenceFor(ecosystem: string) {
  return buildStackEvidence({
    findings: [
      {
        category: "manifest",
        ecosystem,
        detail: `${ecosystem} manifest present`,
        path: "manifest",
        confidence: 0.9,
      },
    ],
  });
}

describe("selectCoverageAdapter — StackEvidence-driven adapter selection", () => {
  it("selects go-cover for a pure-Go fixture repo", () => {
    expect(selectCoverageAdapter(evidenceFor("go"))).toBe("go-cover");
  });

  it("selects pytest-cov for a Python fixture repo", () => {
    expect(selectCoverageAdapter(evidenceFor("python"))).toBe("pytest-cov");
  });

  it("selects istanbul by default for a Node fixture repo", () => {
    expect(selectCoverageAdapter(evidenceFor("node"))).toBe("istanbul");
  });

  it("selects lcov for a Node fixture repo when preferLcov is set", () => {
    expect(selectCoverageAdapter(evidenceFor("node"), { preferLcov: true })).toBe("lcov");
  });

  it("returns undefined when no known ecosystem is present", () => {
    expect(selectCoverageAdapter(evidenceFor("cobol"))).toBeUndefined();
  });

  it("ecosystemsPresent lower-cases and de-duplicates", () => {
    const evidence = buildStackEvidence({
      findings: [
        { category: "manifest", ecosystem: "Go", detail: "d", path: "p", confidence: 0.5 },
        { category: "lockfile", ecosystem: "GO", detail: "d", path: "p", confidence: 0.5 },
      ],
    });
    expect(ecosystemsPresent(evidence)).toEqual(new Set(["go"]));
  });
});

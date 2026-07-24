import { describe, expect, it } from "vitest";
import type { StackEvidenceFinding } from "@eo/contracts";
import { detectContradictions } from "./contradiction.js";

function runtimeFinding(path: string, ecosystem: string, detail: string): StackEvidenceFinding {
  return { category: "language_runtime", ecosystem, detail, path, confidence: 0.9 };
}

describe("detectContradictions", () => {
  it("flags conflicting engines.node values across a monorepo's packages (roadmap/12's own worked example)", () => {
    const findings = [
      runtimeFinding("packages/a/package.json", "node", "engines.node: >=20"),
      runtimeFinding("packages/b/package.json", "node", "engines.node: >=24"),
    ];
    const contradictions = detectContradictions(findings);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.conflictingPaths.sort()).toEqual([
      "packages/a/package.json",
      "packages/b/package.json",
    ]);
    expect(contradictions[0]?.description).toContain("node");
  });

  it("does not flag agreeing declarations across multiple packages", () => {
    const findings = [
      runtimeFinding("packages/a/package.json", "node", "engines.node: >=24"),
      runtimeFinding("packages/b/package.json", "node", "engines.node: >=24"),
    ];
    expect(detectContradictions(findings)).toEqual([]);
  });

  it("keeps ecosystems independent — a node conflict never bleeds into a python finding", () => {
    const findings = [
      runtimeFinding("a/package.json", "node", "engines.node: >=20"),
      runtimeFinding("b/package.json", "node", "engines.node: >=24"),
      runtimeFinding("pyproject.toml", "python", "requires-python: >=3.12"),
    ];
    const contradictions = detectContradictions(findings);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.conflictingPaths).not.toContain("pyproject.toml");
  });

  it("ignores non-language_runtime findings entirely", () => {
    const findings: StackEvidenceFinding[] = [
      { category: "manifest", ecosystem: "node", detail: "x", path: "a", confidence: 0.9 },
      { category: "manifest", ecosystem: "node", detail: "y", path: "b", confidence: 0.9 },
    ];
    expect(detectContradictions(findings)).toEqual([]);
  });

  it("returns an empty array for a single finding per ecosystem (nothing to conflict with)", () => {
    expect(
      detectContradictions([runtimeFinding("package.json", "node", "engines.node: >=24")]),
    ).toEqual([]);
  });
});

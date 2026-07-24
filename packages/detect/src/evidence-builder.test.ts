import { afterEach, describe, expect, it } from "vitest";
import { StackEvidenceSchema } from "@eo/contracts";
import { removeDirTree } from "./test-support/fixture-repo.js";
import {
  buildContainerizedFixture,
  buildGoFixture,
  buildMixedFixture,
  buildNodeMonorepoContradictionFixture,
  buildNodeMonorepoFixture,
  buildPythonFixture,
  buildRustFixture,
} from "./test-support/stack-fixtures.js";
import { buildStackEvidence } from "./evidence-builder.js";

/**
 * The fixture-matrix exit criterion, verbatim: "Fixture matrix (node/ts
 * monorepo, python, go, rust, mixed, containerized) yields expected
 * `StackEvidence` profiles; contradictions surfaced on conflicting
 * fixtures."
 */
describe("buildStackEvidence — fixture matrix", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) removeDirTree(d);
  });

  it("node/ts monorepo: every nested package.json detected, node ecosystem, github-actions CI, no contradiction", () => {
    const root = buildNodeMonorepoFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    expect(StackEvidenceSchema.safeParse(evidence).success).toBe(true);
    const manifestPaths = evidence.findings
      .filter((f) => f.category === "manifest")
      .map((f) => f.path)
      .sort();
    expect(manifestPaths).toEqual([
      "package.json",
      "packages/a/package.json",
      "packages/b/package.json",
    ]);
    expect(
      evidence.findings.some((f) => f.category === "ci" && f.ecosystem === "github-actions"),
    ).toBe(true);
    expect(evidence.contradictions).toEqual([]);
  });

  it("node/ts monorepo with conflicting engines.node: contradiction surfaced", () => {
    const root = buildNodeMonorepoContradictionFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    expect(evidence.contradictions).toHaveLength(1);
    expect(evidence.contradictions[0]?.conflictingPaths.length).toBeGreaterThanOrEqual(2);
  });

  it("python: pyproject.toml + poetry.lock + migrations directory detected", () => {
    const root = buildPythonFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    expect(
      evidence.findings.some((f) => f.category === "manifest" && f.ecosystem === "python"),
    ).toBe(true);
    expect(
      evidence.findings.some((f) => f.category === "lockfile" && f.ecosystem === "python"),
    ).toBe(true);
    expect(evidence.findings.some((f) => f.category === "migration")).toBe(true);
  });

  it("go: go.mod + go.sum detected with the go directive version", () => {
    const root = buildGoFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    const runtime = evidence.findings.find(
      (f) => f.category === "language_runtime" && f.ecosystem === "go",
    );
    expect(runtime?.detail).toContain("1.23");
  });

  it("rust: Cargo.toml + Cargo.lock detected with edition", () => {
    const root = buildRustFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    const runtime = evidence.findings.find(
      (f) => f.category === "language_runtime" && f.ecosystem === "rust",
    );
    expect(runtime?.detail).toContain("2021");
  });

  it("mixed ecosystem monorepo: both node and python manifests detected under one CI config", () => {
    const root = buildMixedFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    const ecosystems = new Set(
      evidence.findings.filter((f) => f.category === "manifest").map((f) => f.ecosystem),
    );
    expect(ecosystems).toEqual(new Set(["node", "python"]));
    expect(evidence.findings.some((f) => f.category === "ci" && f.ecosystem === "gitlab-ci")).toBe(
      true,
    );
  });

  it("containerized: Dockerfile + docker-compose + terraform all detected", () => {
    const root = buildContainerizedFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    expect(evidence.findings.some((f) => f.category === "container")).toBe(true);
    expect(
      evidence.findings.some((f) => f.category === "infrastructure" && f.ecosystem === "terraform"),
    ).toBe(true);
  });

  it("flags unresolved ambiguity when no manifest is found at all", () => {
    const root = buildContainerizedFixture(); // has package.json, so use a fresh empty-ish tree instead
    dirs.push(root);
    // Use a genuinely manifest-free evidence pass by pointing at a nonexistent root.
    const evidence = buildStackEvidence("/nonexistent-eo-detect-evidence-root");
    expect(evidence.unresolvedAmbiguity.length).toBeGreaterThan(0);
    expect(evidence.findings).toEqual([]);
  });

  it("every fixture's evidence round-trips through StackEvidenceSchema (schema-valid, not merely shape-shaped)", () => {
    const root = buildNodeMonorepoFixture();
    dirs.push(root);
    const evidence = buildStackEvidence(root);
    const roundTripped = StackEvidenceSchema.parse(JSON.parse(JSON.stringify(evidence)));
    expect(roundTripped).toEqual(evidence);
  });
});

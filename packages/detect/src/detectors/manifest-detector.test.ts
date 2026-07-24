import { describe, expect, it } from "vitest";
import { buildDetectionContext } from "./types.js";
import { manifestDetector } from "./manifest-detector.js";

function ctxFromPaths(paths: readonly string[]) {
  return buildDetectionContext(
    paths.map((p) => ({ relativePath: p, absolutePath: `/root/${p}` })),
    () => undefined,
  );
}

describe("manifestDetector", () => {
  it("detects a root package.json as node with high confidence", () => {
    const findings = manifestDetector.detect(ctxFromPaths(["package.json"]));
    expect(findings).toEqual([
      {
        category: "manifest",
        ecosystem: "node",
        detail: "package.json present",
        path: "package.json",
        confidence: 0.95,
      },
    ]);
  });

  it("detects nested manifests in a monorepo (each package's own package.json)", () => {
    const findings = manifestDetector.detect(
      ctxFromPaths(["package.json", "packages/a/package.json", "packages/b/package.json"]),
    );
    expect(findings.map((f) => f.path).sort()).toEqual([
      "package.json",
      "packages/a/package.json",
      "packages/b/package.json",
    ]);
  });

  it("detects python (pyproject.toml), go (go.mod), and rust (Cargo.toml) manifests", () => {
    const findings = manifestDetector.detect(
      ctxFromPaths(["pyproject.toml", "go.mod", "Cargo.toml"]),
    );
    const byEcosystem = Object.fromEntries(findings.map((f) => [f.ecosystem, f.path]));
    expect(byEcosystem).toEqual({ python: "pyproject.toml", go: "go.mod", rust: "Cargo.toml" });
  });

  it("returns an empty array for a tree with no recognized manifest", () => {
    expect(manifestDetector.detect(ctxFromPaths(["README.md"]))).toEqual([]);
  });

  it("never matches a filename that merely CONTAINS a manifest name as a substring (e.g. mypackage.json)", () => {
    const findings = manifestDetector.detect(ctxFromPaths(["mypackage.json"]));
    expect(findings).toEqual([]);
  });
});

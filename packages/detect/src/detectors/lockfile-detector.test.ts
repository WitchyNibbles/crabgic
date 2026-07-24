import { describe, expect, it } from "vitest";
import { buildDetectionContext } from "./types.js";
import { lockfileDetector } from "./lockfile-detector.js";

function ctxFromPaths(paths: readonly string[]) {
  return buildDetectionContext(
    paths.map((p) => ({ relativePath: p, absolutePath: `/root/${p}` })),
    () => undefined,
  );
}

describe("lockfileDetector", () => {
  it("detects package-lock.json as node", () => {
    const findings = lockfileDetector.detect(ctxFromPaths(["package-lock.json"]));
    expect(findings).toEqual([
      {
        category: "lockfile",
        ecosystem: "node",
        detail: "package-lock.json present",
        path: "package-lock.json",
        confidence: 0.95,
      },
    ]);
  });

  it("detects poetry.lock (python), go.sum (go), Cargo.lock (rust)", () => {
    const findings = lockfileDetector.detect(ctxFromPaths(["poetry.lock", "go.sum", "Cargo.lock"]));
    expect(findings.map((f) => f.ecosystem).sort()).toEqual(["go", "python", "rust"]);
  });

  it("returns an empty array when no lockfile is present", () => {
    expect(lockfileDetector.detect(ctxFromPaths(["README.md"]))).toEqual([]);
  });
});

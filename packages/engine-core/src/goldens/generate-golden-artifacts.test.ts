/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGoldenArtifacts } from "./generate-golden-artifacts.js";

/**
 * Golden settings artifacts — byte-diff test (roadmap/03-envelope-
 * compiler-engine-adapter.md work item 3: "Golden settings artifacts for
 * the three canonical envelopes … failing-first: a byte-diff test against
 * a golden file that doesn't exist yet"). Before the golden files under
 * `packages/engine-core/goldens/` are committed, every `it` below fails
 * with `ENOENT` — the roadmap's own sanctioned failing-first form for this
 * sub-part (see docs/evidence/phase-03/wi3-sandbox-goldens-failing.txt).
 */
const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "goldens");

describe("golden settings artifacts — byte-stability against committed goldens", () => {
  for (const artifact of buildGoldenArtifacts()) {
    it(`${artifact.relativePath} is byte-identical to the committed golden`, () => {
      const committed = readFileSync(join(GOLDENS_DIR, artifact.relativePath), "utf8");
      expect(artifact.content).toBe(committed);
    });
  }
});

describe("golden settings artifacts — byte-stability across two consecutive in-process generations", () => {
  it("buildGoldenArtifacts() produces deep-equal output on two consecutive calls", () => {
    const first = buildGoldenArtifacts();
    const second = buildGoldenArtifacts();
    expect(second).toEqual(first);
  });

  it("every artifact's content ends with exactly one trailing newline (JSON.stringify(...,null,2)+\\n convention)", () => {
    for (const artifact of buildGoldenArtifacts()) {
      expect(artifact.content.endsWith("\n")).toBe(true);
      expect(artifact.content.endsWith("\n\n")).toBe(false);
    }
  });

  it("produces exactly six artifacts — 2 serializations x 3 canonical envelopes", () => {
    expect(buildGoldenArtifacts()).toHaveLength(6);
  });
});

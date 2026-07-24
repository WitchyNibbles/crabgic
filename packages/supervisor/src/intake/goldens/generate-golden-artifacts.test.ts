/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGoldenIntakeArtifacts } from "./generate-golden-artifacts.js";

/**
 * Golden intake-artifact byte-diff test — roadmap/11-intake-contract-
 * approval.md §Exit criteria: "Golden IntentContract/DAG/
 * AuthorizationEnvelope/CapabilityManifest fixtures byte-stable across two
 * builds." Mirrors `packages/engine-core/src/goldens/generate-golden-
 * artifacts.test.ts`'s own two-part structure: (1) byte-diff against the
 * committed golden files under `packages/supervisor/goldens/`, (2)
 * byte-stability across two independent in-process builds.
 */
const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "goldens");

describe("golden intake artifacts — byte-stability against committed goldens", () => {
  for (const artifact of buildGoldenIntakeArtifacts()) {
    it(`${artifact.relativePath} is byte-identical to the committed golden`, () => {
      const committed = readFileSync(join(GOLDENS_DIR, artifact.relativePath), "utf8");
      expect(artifact.content).toBe(committed);
    });
  }
});

describe("golden intake artifacts — byte-stability across two consecutive in-process builds", () => {
  it("buildGoldenIntakeArtifacts() produces deep-equal output on two consecutive calls", () => {
    const first = buildGoldenIntakeArtifacts();
    const second = buildGoldenIntakeArtifacts();
    expect(second).toEqual(first);
  });

  it("every artifact's content ends with exactly one trailing newline", () => {
    for (const artifact of buildGoldenIntakeArtifacts()) {
      expect(artifact.content.endsWith("\n")).toBe(true);
      expect(artifact.content.endsWith("\n\n")).toBe(false);
    }
  });

  it("produces exactly 6 golden artifacts", () => {
    expect(buildGoldenIntakeArtifacts()).toHaveLength(6);
  });
});

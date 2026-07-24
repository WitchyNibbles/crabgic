/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGoldenTaskPackets } from "./generate-golden-packets.js";

/**
 * Golden TaskPacket byte-diff test — mirrors `packages/supervisor/src/
 * intake/goldens/generate-golden-artifacts.test.ts`'s own two-part
 * structure: (1) byte-diff against the committed golden files under
 * `packages/scheduler/goldens/`, (2) byte-stability across two independent
 * in-process builds.
 */
const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "goldens");

describe("golden TaskPackets — byte-stability against committed goldens", () => {
  for (const artifact of buildGoldenTaskPackets()) {
    it(`${artifact.relativePath} is byte-identical to the committed golden`, () => {
      const committed = readFileSync(join(GOLDENS_DIR, artifact.relativePath), "utf8");
      expect(artifact.content).toBe(committed);
    });
  }
});

describe("golden TaskPackets — byte-stability across two consecutive in-process builds", () => {
  it("buildGoldenTaskPackets() produces deep-equal output on two consecutive calls", () => {
    const first = buildGoldenTaskPackets();
    const second = buildGoldenTaskPackets();
    expect(second).toEqual(first);
  });

  it("every artifact's content ends with exactly one trailing newline", () => {
    for (const artifact of buildGoldenTaskPackets()) {
      expect(artifact.content.endsWith("\n")).toBe(true);
      expect(artifact.content.endsWith("\n\n")).toBe(false);
    }
  });

  it("produces exactly 2 golden artifacts", () => {
    expect(buildGoldenTaskPackets()).toHaveLength(2);
  });
});

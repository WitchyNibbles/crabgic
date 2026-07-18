/**
 * Golden-artifact write script (roadmap/03-envelope-compiler-engine-
 * adapter.md §In scope: "emitted by a small deterministic script or test
 * helper"). Run with `npm run build:goldens` from `packages/engine-core`
 * (runs `tsc -b` first automatically), or `node scripts/write-goldens.ts`
 * after a manual `npx tsc -b packages/engine-core`.
 *
 * Execution choice — mirrors `packages/contracts/scripts/build-schemas.ts`'s
 * own documented choice verbatim: imports the already-**compiled**
 * `../dist/goldens/generate-golden-artifacts.js` rather than `../src`
 * directly, because Node's native type-stripping does not remap `src`'s
 * NodeNext `.js`-suffixed relative imports to their sibling `.ts` files.
 */
/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoldenArtifacts } from "../dist/goldens/generate-golden-artifacts.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SCRIPT_DIR, "..");
const GOLDENS_DIR = join(PACKAGE_ROOT, "goldens");

mkdirSync(GOLDENS_DIR, { recursive: true });

const artifacts = buildGoldenArtifacts();
for (const artifact of artifacts) {
  const outPath = join(GOLDENS_DIR, artifact.relativePath);
  writeFileSync(outPath, artifact.content, "utf8");
  process.stdout.write(`wrote ${outPath}\n`);
}

process.stdout.write(`done: ${artifacts.length} golden artifact(s) written to ${GOLDENS_DIR}\n`);

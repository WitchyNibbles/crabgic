/**
 * Golden intake-artifact write script — mirrors `packages/engine-core/
 * scripts/write-goldens.ts`'s own documented convention verbatim: run with
 * `node scripts/write-goldens.ts` from `packages/supervisor` after
 * `npx tsc -b packages/supervisor` (imports the compiled
 * `../dist/intake/goldens/generate-golden-artifacts.js`, since Node's
 * native type-stripping does not remap `src`'s NodeNext `.js`-suffixed
 * relative imports to their sibling `.ts` files).
 */
/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoldenIntakeArtifacts } from "../dist/intake/goldens/generate-golden-artifacts.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SCRIPT_DIR, "..");
const GOLDENS_DIR = join(PACKAGE_ROOT, "goldens");

mkdirSync(GOLDENS_DIR, { recursive: true });

const artifacts = buildGoldenIntakeArtifacts();
for (const artifact of artifacts) {
  const outPath = join(GOLDENS_DIR, artifact.relativePath);
  writeFileSync(outPath, artifact.content, "utf8");
  process.stdout.write(`wrote ${outPath}\n`);
}

process.stdout.write(`done: ${artifacts.length} golden artifact(s) written to ${GOLDENS_DIR}\n`);

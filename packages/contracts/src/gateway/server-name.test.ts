/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "./server-name.js";

/**
 * `GATEWAY_MCP_SERVER_NAME` tests (roadmap/02 work item 7; interface-
 * ledger Gap 11). Two things are proven here:
 *  1. The golden value: the literal is exactly `"eo_gateway"`.
 *  2. The sole-definition-site exit criterion: a read-only, deterministic
 *     scan of every `.ts` file under each workspace package's `src`
 *     directory proves the literal `"eo_gateway"` appears nowhere except
 *     this constant's own definition file and this golden-value test file
 *     itself.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const LITERAL = "eo_gateway";

/**
 * The sole-definition-site allowlist: only `server-name.ts` (the
 * definition) and `server-name.test.ts` (this golden-value test, which
 * necessarily also quotes the literal) may contain it. Every other
 * consumer must import `GATEWAY_MCP_SERVER_NAME` instead.
 */
const ALLOWLISTED_RELATIVE_PATHS = new Set<string>([
  join("packages", "contracts", "src", "gateway", "server-name.ts"),
  join("packages", "contracts", "src", "gateway", "server-name.test.ts"),
]);

/** Read-only recursive walk of every `.ts` file under `dir`. */
function collectTsFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...collectTsFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * Every workspace package's `src/` directory, tolerant of packages that
 * don't have one yet (empty stubs, or other workers' in-flight work not
 * yet landed) — read-only, never throws on a missing directory.
 */
function findPackageSrcDirs(): readonly string[] {
  const packageNames = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const srcDirs: string[] = [];
  for (const name of packageNames) {
    const srcDir = join(PACKAGES_DIR, name, "src");
    try {
      if (statSync(srcDir).isDirectory()) {
        srcDirs.push(srcDir);
      }
    } catch {
      // No src/ yet for this package — tolerate and skip.
    }
  }
  return srcDirs;
}

describe("GATEWAY_MCP_SERVER_NAME", () => {
  it('is the literal "eo_gateway" (golden value, interface-ledger Gap 11)', () => {
    expect(GATEWAY_MCP_SERVER_NAME).toBe("eo_gateway");
  });

  it("is the sole definition site of the literal under packages/*/src (exit criterion)", () => {
    const violations: Array<{ file: string; occurrences: number }> = [];

    for (const srcDir of findPackageSrcDirs()) {
      for (const filePath of collectTsFiles(srcDir)) {
        const relPath = relative(REPO_ROOT, filePath);
        if (ALLOWLISTED_RELATIVE_PATHS.has(relPath)) continue;

        const content = readFileSync(filePath, "utf8");
        const occurrences = content.split(LITERAL).length - 1;
        if (occurrences > 0) {
          violations.push({ file: relPath, occurrences });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `@learning-redteam` — adaptation §2 row 12: "Promptfoo/evals, no
 * managed-eval dependency." roadmap/22-learning-system.md §In scope: "an
 * optional Promptfoo adapter (package-internal export, no new CLI verb) —
 * no managed-platform dependency." This test proves BOTH halves
 * structurally: `package.json` never declares `promptfoo` as a
 * dependency, and no source file under `packages/learning/src` ever
 * imports it.
 */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = join(PACKAGE_ROOT, "src");

function collectSourceFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

describe("@learning-redteam no promptfoo third-party dependency", () => {
  it("package.json declares no 'promptfoo' dependency (dependencies or devDependencies)", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("promptfoo");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("promptfoo");
  });

  it("no source file imports the 'promptfoo' package", () => {
    const violations: string[] = [];
    for (const filePath of collectSourceFiles(SRC_DIR)) {
      const content = readFileSync(filePath, "utf8");
      if (
        /from\s+["']promptfoo["']/.test(content) ||
        /require\(["']promptfoo["']\)/.test(content)
      ) {
        violations.push(filePath);
      }
    }
    expect(violations).toEqual([]);
  });
});

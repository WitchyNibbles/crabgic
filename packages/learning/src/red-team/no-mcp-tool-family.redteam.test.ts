import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `@learning-redteam` — roadmap/22-learning-system.md §Exit criteria:
 * "a grep-based CI check over `packages/gateway`'s registered tool names
 * confirms no `learning.*` MCP tool exists to route around it (Gap 1)."
 * §In scope, "Separation of duties": "No MCP `learning.*` tool family
 * exists — promotion/review is CLI-only ... a model-invokable promotion
 * tool would violate this section's tested invariant that an active run
 * cannot promote its own policy."
 *
 * This is a READ-ONLY scan of `packages/gateway/src` — this suite never
 * writes to, imports from (at the module-graph level; `readFileSync` on
 * source text is not an import), or otherwise depends on `@eo/gateway` as
 * a package. It lives here (not in `packages/gateway`) because this
 * phase — not 16 — owns the permanent absence this check enforces
 * (interface-ledger Gap 1: "Phase 22 carries a grep-based CI check ...
 * permanently enforcing this absence").
 */
const GATEWAY_SRC_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "gateway",
  "src",
);

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

describe("@learning-redteam no learning.* MCP tool family exists anywhere under packages/gateway/src", () => {
  it("this scanner's target directory actually resolves (sanity: the scan is not vacuous)", () => {
    expect(statSync(GATEWAY_SRC_DIR).isDirectory()).toBe(true);
    expect(collectSourceFiles(GATEWAY_SRC_DIR).length).toBeGreaterThan(1);
  });

  it("no registered MCP tool name anywhere begins with the 'learning.' prefix", () => {
    const violations: Array<{ file: string; line: string }> = [];
    const toolNamePattern = /name:\s*["']learning\./;

    for (const filePath of collectSourceFiles(GATEWAY_SRC_DIR)) {
      const content = readFileSync(filePath, "utf8");
      for (const line of content.split("\n")) {
        if (toolNamePattern.test(line)) {
          violations.push({ file: relative(GATEWAY_SRC_DIR, filePath), line: line.trim() });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("the bare literal 'learning.' never appears as a STRING LITERAL in any non-test registration source (stronger, whole-substring form; test files are exempt since 16's own suite legitimately asserts this same absence in prose/assertions)", () => {
    const violations: Array<{ file: string; occurrences: number }> = [];

    for (const filePath of collectSourceFiles(GATEWAY_SRC_DIR)) {
      if (filePath.endsWith(".test.ts")) continue;
      const content = readFileSync(filePath, "utf8");
      const occurrences =
        content.split('"learning.').length - 1 + content.split("'learning.").length - 1;
      if (occurrences > 0) {
        violations.push({ file: relative(GATEWAY_SRC_DIR, filePath), occurrences });
      }
    }

    expect(violations).toEqual([]);
  });
});

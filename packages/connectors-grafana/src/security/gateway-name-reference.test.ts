/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";

/**
 * Mirrors `packages/gateway/src/mcp/gateway-name-reference.test.ts`'s own
 * package-local instantiation of this proof (interface-ledger Gap 11):
 * the literal value of `GATEWAY_MCP_SERVER_NAME` must never
 * appear hand-typed anywhere under this package's `.ts` sources —
 * including comments and test strings — only the imported constant's NAME
 * is ever referenced. This file deliberately never spells the literal
 * value itself, only the constant's name, so it does not trip its own scan.
 */
const LITERAL = GATEWAY_MCP_SERVER_NAME;
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

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

describe("zero hand-typed gateway server-name literals under packages/connectors-grafana/src", () => {
  it("the Gap-11 literal appears nowhere in this package's source, this scanner included", () => {
    const violations: Array<{ file: string; occurrences: number }> = [];

    for (const filePath of collectSourceFiles(SRC_DIR)) {
      const content = readFileSync(filePath, "utf8");
      const occurrences = content.split(LITERAL).length - 1;
      if (occurrences > 0) {
        violations.push({ file: relative(SRC_DIR, filePath), occurrences });
      }
    }

    expect(violations).toEqual([]);
  });

  it("this scanner's own directory actually resolves (sanity: the scan is not vacuous)", () => {
    expect(statSync(SRC_DIR).isDirectory()).toBe(true);
    expect(collectSourceFiles(SRC_DIR).length).toBeGreaterThan(1);
  });
});

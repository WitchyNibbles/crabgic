/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";

/**
 * Mirrors `packages/gateway/src/mcp/gateway-name-reference.test.ts`'s own
 * package-local instantiation of this proof (CLAUDE.md non-negotiable:
 * any gateway-server-name reference must import `GATEWAY_MCP_SERVER_NAME`
 * from `@eo/contracts` — this constant's own literal value must NOT
 * appear anywhere in this package's `.ts` files, including comments/
 * test-strings/templates). This connector never has reason to reference
 * the gateway
 * MCP server name at all (roadmap/18 §Interfaces consumed: "this phase
 * registers no MCP tool of its own" — it registers a provider CLIENT into
 * `@eo/gateway`'s already-registered `tracker.*` tools, never a server
 * name), so this scan is expected to find zero occurrences trivially —
 * it exists to catch a FUTURE regression, not because a violation was
 * ever suspected.
 *
 * This file deliberately never spells the literal value itself, only the
 * constant's name, so it does not trip its own scan below.
 */
const LITERAL = GATEWAY_MCP_SERVER_NAME;
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

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

describe("zero hand-typed gateway server-name literals under packages/connectors-jira/src", () => {
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

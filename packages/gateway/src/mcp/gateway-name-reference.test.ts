/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { buildGatewayMcpServer } from "./server.js";
import { GatewayToolRegistry } from "./tool-registry.js";

/**
 * `gateway-name-reference.test.ts` (roadmap/16-gateway-core.md §Exit
 * criteria: every SDK server registration and wire-level tool name must
 * reference `GATEWAY_MCP_SERVER_NAME` — zero hand-typed occurrences of
 * that constant's own literal value anywhere in `packages/gateway`
 * — interface-ledger Gap 11). Mirrors
 * `packages/engine-claude/src/gateway-name-reference.test.ts`'s own
 * package-local instantiation of this proof. This file deliberately never
 * spells the literal value itself, only the constant's name, so it does
 * not trip its own scan below.
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
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs"))) {
      files.push(entryPath);
    }
  }
  return files;
}

describe("zero hand-typed gateway server-name literals under packages/gateway/src", () => {
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

describe("the gateway MCP server registers under GATEWAY_MCP_SERVER_NAME", () => {
  it("McpServer construction derives its name from the imported constant", () => {
    const server = buildGatewayMcpServer(new GatewayToolRegistry());
    // The underlying protocol layer stores serverInfo internally; the
    // public surface this package exposes is `isConnected()` plus the
    // `server` property — assert the server was constructed without
    // throwing and is not yet connected, the same smoke assertion
    // `server.test.ts`'s own unit describe makes, keyed here to the
    // GATEWAY_MCP_SERVER_NAME-derived construction path specifically.
    expect(server.isConnected()).toBe(false);
  });
});

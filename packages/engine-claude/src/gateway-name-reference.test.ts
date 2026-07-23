/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { CANONICAL_ENVELOPE_CASES, compileEnvelope } from "@eo/engine-core";
import { buildWorkerEnv } from "./auth.js";
import { assembleWorkerOptions } from "./options-assembler.js";

/**
 * `gateway-name-reference.test.ts` (exit-criterion name, roadmap/06-claude-
 * engine-adapter.md §Exit criteria: zero hand-typed gateway server-name
 * literals anywhere in `packages/engine-claude`; interface-ledger Gap 11).
 * Two things are proven:
 *  1. A read-only scan of every `.ts` file under this package's `src/`
 *     proves the Gap-11 server-name literal appears nowhere at all — the
 *     scan needle itself is derived from the imported
 *     `GATEWAY_MCP_SERVER_NAME` constant, never hand-typed, so this file
 *     carries zero occurrences too and 02's own sole-definition-site
 *     scanner (`packages/contracts/src/gateway/server-name.test.ts`) stays
 *     green with no allowlist entry.
 *  2. The assembled `Options`' `mcpServers` key is `GATEWAY_MCP_SERVER_NAME`
 *     byte-for-byte and `strictMcpConfig` is `true`.
 */
const LITERAL = GATEWAY_MCP_SERVER_NAME;
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

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

describe("zero hand-typed gateway server-name literals under packages/engine-claude/src", () => {
  it("the Gap-11 literal appears nowhere in this package's source, this scanner included", () => {
    const violations: Array<{ file: string; occurrences: number }> = [];

    for (const filePath of collectTsFiles(SRC_DIR)) {
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
    expect(collectTsFiles(SRC_DIR).length).toBeGreaterThan(1);
  });
});

describe("assembled Options reference GATEWAY_MCP_SERVER_NAME byte-for-byte", () => {
  it("mcpServers is keyed by GATEWAY_MCP_SERVER_NAME and strictMcpConfig is true", () => {
    const firstCase = CANONICAL_ENVELOPE_CASES[0];
    if (firstCase === undefined) {
      throw new Error("CANONICAL_ENVELOPE_CASES is unexpectedly empty");
    }
    const profile = compileEnvelope(firstCase.envelope);
    const options = assembleWorkerOptions({
      profile,
      worktreePath: "/fixture/worktree",
      workerTmp: "/fixture/worker-tmp",
      env: buildWorkerEnv({
        hostPath: "/usr/bin:/bin",
        provisioning: {
          HOME: "/fixture/home",
          TMP: "/fixture/tmp",
          CLAUDE_CONFIG_DIR: "/fixture/claude-config",
        },
        authEnv: {},
      }),
      session: { mode: "assign", sessionId: "00000000-0000-4000-8000-000000000000" },
      maxTurns: 4,
      resultSchema: { type: "object" },
    });

    expect(options.mcpServers).toBeDefined();
    expect(Object.keys(options.mcpServers ?? {})).toEqual([GATEWAY_MCP_SERVER_NAME]);
    expect(options.strictMcpConfig).toBe(true);
  });
});

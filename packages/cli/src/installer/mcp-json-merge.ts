/**
 * Project-scope `.mcp.json` add-only merge — roadmap/10-plugin-and-
 * installer.md §In scope: "project-scope `.mcp.json` entry keyed
 * `GATEWAY_MCP_SERVER_NAME` (constant, 02) whose command is exactly
 * `engineering-orchestrator gateway mcp` (09)." Golden-test target
 * (`mcp-entry.golden.test`): the literal `.mcp.json` shape below MUST equal
 * `{"GATEWAY_MCP_SERVER_NAME": {"command": "engineering-orchestrator", "args":
 * ["gateway", "mcp"]}}` byte-for-byte — this file references the imported
 * `GATEWAY_MCP_SERVER_NAME` constant, never a hand-typed literal (this
 * package's own repo-wide sole-definition-site scanner,
 * `@eo/contracts`'s `server-name.test.ts`, forbids it).
 */
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";

export interface McpServerEntry {
  readonly command: string;
  readonly args: readonly string[];
}

export interface McpJsonMergeResult {
  readonly mcpJson: Record<string, unknown>;
  readonly changed: boolean;
}

/** The exact entry this installer writes — `engineering-orchestrator gateway mcp`, per roadmap/10 §Interfaces produced, byte-for-byte. */
export function buildGatewayMcpServerEntry(): McpServerEntry {
  return { command: "engineering-orchestrator", args: ["gateway", "mcp"] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges the gateway entry into `existing`'s `mcpServers` map, add-only:
 * never touches an already-present entry under `GATEWAY_MCP_SERVER_NAME`
 * (even if it points somewhere else), and preserves every other configured
 * server untouched.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-24, CONFIRMED — identical bug to
 * `./settings-merge.ts`'s `enabledPlugins`): a present-but-non-object
 * `mcpServers` (e.g. a string/array/null) used to be silently treated as
 * ABSENT and overwritten with a fresh `{[GATEWAY_MCP_SERVER_NAME]: ...}`
 * map, destroying the user's own value. Guarded by presence now
 * (`"mcpServers" in existing`) — a present-but-wrong-typed value is never
 * touched at all.
 */
export function mergeMcpJson(existing: Record<string, unknown>): McpJsonMergeResult {
  if ("mcpServers" in existing && !isPlainObject(existing.mcpServers)) {
    return { mcpJson: { ...existing }, changed: false };
  }

  const existingServers = isPlainObject(existing.mcpServers) ? existing.mcpServers : {};

  if (GATEWAY_MCP_SERVER_NAME in existingServers) {
    return { mcpJson: { ...existing, mcpServers: existingServers }, changed: false };
  }

  const merged = {
    ...existing,
    mcpServers: { ...existingServers, [GATEWAY_MCP_SERVER_NAME]: buildGatewayMcpServerEntry() },
  };
  return { mcpJson: merged, changed: true };
}

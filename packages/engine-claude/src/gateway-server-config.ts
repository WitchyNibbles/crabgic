import type { McpServerConfig, McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";

/**
 * `gateway-server-config` — roadmap/06-claude-engine-adapter.md §In scope,
 * "Gateway wiring (Gap 11, Gap 2)": the worker connects to the gateway MCP
 * server as an external stdio process, `engineering-orchestrator gateway
 * mcp` — the identical shape 10's `.mcp.json` entry uses (interface-ledger
 * Gap 2's exact argv) — never an in-process import of `packages/gateway`
 * (README design decision 5; roadmap/06 §Risks).
 *
 * Keyed by `GATEWAY_MCP_SERVER_NAME` (imported from `@eo/contracts`) —
 * this package's own exit criterion (`gateway-name-reference.test.ts`)
 * proves zero hand-typed literals of that constant's value exist anywhere
 * else under `packages/engine-claude/src`.
 */
const DEFAULT_GATEWAY_SERVER_CONFIG: McpStdioServerConfig = {
  type: "stdio",
  command: "engineering-orchestrator",
  args: ["gateway", "mcp"],
};

/**
 * Builds the `Options.mcpServers` record for the single gateway entry.
 * `override` (from `ClaudeEngineAdapterConfig.gatewayServerOverride`, a
 * test seam pointing at a stub server) replaces the entry VALUE only —
 * the key is always `GATEWAY_MCP_SERVER_NAME`, never overridable.
 */
export function buildGatewayMcpServers(
  override?: Readonly<Record<string, unknown>>,
): Record<string, McpServerConfig> {
  const entry: McpServerConfig =
    override === undefined
      ? DEFAULT_GATEWAY_SERVER_CONFIG
      : (override as unknown as McpServerConfig);

  return { [GATEWAY_MCP_SERVER_NAME]: entry };
}

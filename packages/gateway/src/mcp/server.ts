/**
 * The sole gateway MCP server — roadmap/16-gateway-core.md §In scope,
 * "Sole MCP host & extensible tool-registration API": this phase hosts
 * the one gateway MCP server named by `GATEWAY_MCP_SERVER_NAME` (constant
 * owned by 02). Work item 5. (This comment deliberately never spells that
 * constant's literal value itself, only the constant's name — so
 * `@eo/contracts`' repo-wide sole-definition-site scanner
 * (`server-name.test.ts`) stays green with no allowlist entry needed for
 * this file; see `gateway-name-reference.test.ts` for this package's own
 * local instantiation of that same zero-hand-typed-literal proof.)
 *
 * Adapts a `GatewayToolRegistry` (framework-agnostic) onto a real
 * `@modelcontextprotocol/sdk` `McpServer` instance — the one module in
 * this package that imports the MCP SDK's server type directly. Every
 * wire-level tool name derives from `GATEWAY_MCP_SERVER_NAME`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import type { GatewayToolRegistry } from "./tool-registry.js";

/** Builds an `McpServer` with every tool in `registry` registered onto it. Booting against an empty registry lists a well-formed, empty tool set (roadmap/16, work item 5's own failing-first note). */
export function buildGatewayMcpServer(registry: GatewayToolRegistry): McpServer {
  const server = new McpServer({ name: GATEWAY_MCP_SERVER_NAME, version: "0.0.0" });

  for (const tool of registry.list()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args as never);
        return { content: [...result.content], ...(result.isError !== undefined ? { isError: result.isError } : {}) };
      },
    );
  }

  return server;
}

/** Connects `server` to `transport` and awaits readiness — the thin call a stdio-boot entry point (09's `gateway mcp` shim, or this package's own boot fixtures) makes after `buildGatewayMcpServer`. */
export async function connectGatewayMcpServer(
  server: McpServer,
  transport: Transport,
): Promise<void> {
  await server.connect(transport);
}

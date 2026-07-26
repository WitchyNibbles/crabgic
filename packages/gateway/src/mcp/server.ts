/**
 * The sole gateway MCP server — roadmap/16-gateway-core.md §In scope,
 * "Sole MCP host & extensible tool-registration API": this phase hosts
 * the one gateway MCP server named by `GATEWAY_MCP_SERVER_NAME` (constant
 * owned by 02). Work item 5. (This comment deliberately never spells that
 * constant's literal value itself, only the constant's name — so
 * `@crabgic/contracts`' repo-wide sole-definition-site scanner
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
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import type { GatewayToolRegistry } from "./tool-registry.js";

/** Builds an `McpServer` with every tool in `registry` registered onto it. Booting against an empty registry lists a well-formed, empty tool set (roadmap/16, work item 5's own failing-first note). */
export function buildGatewayMcpServer(registry: GatewayToolRegistry): McpServer {
  // The `tools` capability is declared UP FRONT rather than left to the
  // SDK's implicit registration-time inference, so that an empty registry
  // still answers `tools/list` with a well-formed empty set instead of an
  // "unsupported capability" error (roadmap/16, work item 5's own
  // failing-first note). Booting with zero tools is a legitimate degraded
  // state — it must never look like a broken server to the client.
  const server = new McpServer(
    { name: GATEWAY_MCP_SERVER_NAME, version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  // The SDK installs its `tools/list`/`tools/call` request handlers lazily,
  // on the FIRST `registerTool` call — so a server built from an empty
  // registry would answer `tools/list` with METHOD_NOT_FOUND rather than an
  // empty set, which reads to a client as a broken server rather than a
  // legitimately unconfigured one. Registering a placeholder and removing it
  // installs those handlers while leaving the advertised tool set genuinely
  // empty. Declaring the capability above is not sufficient on its own:
  // capabilities describe what the server supports, handlers are what
  // answer the call.
  const tools = registry.list();
  if (tools.length === 0) {
    server
      .registerTool("__handler_bootstrap__", { description: "" }, async () => ({
        content: [],
      }))
      .remove();
  }

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args as never);
        return {
          content: [...result.content],
          ...(result.isError !== undefined ? { isError: result.isError } : {}),
        };
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

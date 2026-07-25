/**
 * The `gateway mcp` stdio boot — the one call `packages/cli`'s entry point
 * makes to put a populated `GatewayToolRegistry` on the wire.
 *
 * WHY IT LIVES HERE (2026-07-25). `packages/cli` used to boot its own
 * hand-rolled ndjson JSON-RPC subset, written when `@modelcontextprotocol/
 * sdk` was only transitively resolved and adding it meant editing the root
 * lockfile. That subset implemented `initialize` and `tools/list` only:
 * `tools/call` returned METHOD_NOT_FOUND unconditionally, so no registered
 * tool could ever be invoked, and — worse for a shipping product — it
 * replied to NOTIFICATIONS with error responses. A JSON-RPC notification
 * carries no id and must never be answered; Claude Code sends
 * `notifications/initialized` immediately after the handshake, so a real
 * client would have seen a protocol violation on its very first exchange.
 *
 * The SDK is now a declared dependency of this package, and `./server.ts`
 * already adapts a registry onto a real `McpServer`. Hosting the transport
 * here too keeps the SDK edge entirely inside `@eo/gateway` — the CLI
 * depends on this function, never on `@modelcontextprotocol/sdk` directly.
 */

import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildGatewayMcpServer } from "./server.js";
import type { GatewayToolRegistry } from "./tool-registry.js";

export interface GatewayMcpStdioOptions {
  /** Defaults to `process.stdin` — the pipe the parent (Claude Code) owns. Injectable so conformance tests need no child process. */
  readonly input?: Readable;
  /** Defaults to `process.stdout`. */
  readonly output?: Writable;
}

/**
 * Builds an `McpServer` over `registry` and connects it to a stdio
 * transport, resolving once the server is ready to serve. The returned
 * server stays live until its `close()` is called or the input stream ends
 * — the real boot only ends when the parent closes the pipe.
 */
export async function connectGatewayMcpStdio(
  registry: GatewayToolRegistry,
  options: GatewayMcpStdioOptions = {},
): Promise<McpServer> {
  const server = buildGatewayMcpServer(registry);
  const transport = new StdioServerTransport(options.input, options.output);
  await server.connect(transport);
  return server;
}

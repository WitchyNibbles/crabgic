#!/usr/bin/env node
/**
 * Minimal MCP stdio server for the `@live` conformance suite (W5).
 *
 * The real `ClaudeEngineAdapter` ALWAYS wires an `mcpServers` entry keyed by
 * `GATEWAY_MCP_SERVER_NAME` pointing at the external `engineering-orchestrator
 * gateway mcp` process (`gateway-server-config.ts`) — which does not exist on
 * a CI runner or this dev host (that binary is phase 09/16's, not built here).
 * `ClaudeEngineAdapterConfig.gatewayServerOverride` is the sanctioned test
 * seam ("tests point this at a stub") for exactly this: the live suite points
 * the gateway entry at THIS process so every real-adapter spawn wires a
 * gateway server that actually completes the MCP `initialize` handshake and
 * advertises zero tools, instead of a command that fails to spawn.
 *
 * The suite never exercises a gateway TOOL (that is 16's surface); it only
 * needs the worker to START cleanly with the real assembled `Options`
 * (mcpServers keyed off the constant, `strictMcpConfig: true`). Newline-
 * delimited JSON-RPC 2.0 is the MCP stdio framing; a request whose method we
 * do not special-case gets an empty `result`, and notifications get no reply.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "eo-live-stub-gateway", version: "0.0.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [] } });
    return;
  }
  if (method === "resources/list") {
    send({ jsonrpc: "2.0", id, result: { resources: [] } });
    return;
  }
  if (method === "prompts/list") {
    send({ jsonrpc: "2.0", id, result: { prompts: [] } });
    return;
  }
  // Notifications carry no `id` and expect no response.
  if (id === undefined || id === null) {
    return;
  }
  // Any other request: a benign empty result, never an error (keeps the
  // engine's MCP client from treating the gateway as broken).
  send({ jsonrpc: "2.0", id, result: {} });
});

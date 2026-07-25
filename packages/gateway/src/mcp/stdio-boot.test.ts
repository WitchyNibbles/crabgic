import { PassThrough } from "node:stream";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { GatewayToolRegistry } from "./tool-registry.js";
import { connectGatewayMcpStdio } from "./stdio-boot.js";

/**
 * Drives a real JSON-RPC conversation over the boot's own stdio streams and
 * collects one response per request id. The MCP SDK requires the full
 * `initialize` -> `notifications/initialized` handshake before it will serve
 * anything, which is precisely what the hand-rolled ndjson server this
 * replaces could not do: it answered the notification (a message with NO
 * id, which must never be replied to) with an error response.
 */
async function converse(
  registry: GatewayToolRegistry,
  requests: readonly Record<string, unknown>[],
): Promise<Map<number, Record<string, unknown>>> {
  const input = new PassThrough();
  const output = new PassThrough();
  const responses = new Map<number, Record<string, unknown>>();
  let buffered = "";

  output.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line.length > 0) {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (typeof message.id === "number") responses.set(message.id, message);
      }
      newline = buffered.indexOf("\n");
    }
  });

  const server = await connectGatewayMcpStdio(registry, { input, output });

  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "conformance-probe", version: "0.0.0" },
      },
    })}\n`,
  );
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  for (const request of requests) input.write(`${JSON.stringify(request)}\n`);

  // One macrotask turn per queued message is enough for the SDK's own
  // async dispatch to drain; the assertions below fail loudly if it is not.
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));

  await server.close();
  return responses;
}

function probeRegistry(): GatewayToolRegistry {
  const registry = new GatewayToolRegistry();
  registry.register({
    name: "probe.echo",
    description: "Echoes its argument back — a stand-in for any real family leaf.",
    inputSchema: { value: z.string() },
    handler: async (args) => ({ content: [{ type: "text", text: `echoed:${args.value}` }] }),
  });
  return registry;
}

describe("connectGatewayMcpStdio", () => {
  it("completes the MCP handshake under GATEWAY_MCP_SERVER_NAME", async () => {
    const responses = await converse(probeRegistry(), []);

    const initialize = responses.get(1);
    expect(initialize).toBeDefined();
    const result = initialize!.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe(GATEWAY_MCP_SERVER_NAME);
  });

  it("lists exactly the resolved tool set to a stub MCP client", async () => {
    const responses = await converse(probeRegistry(), [
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const listed = (responses.get(2)!.result as { tools: { name: string }[] }).tools;
    expect(listed.map((t) => t.name)).toEqual(["probe.echo"]);
  });

  /**
   * The gap this whole boot exists to close: the previous stdio path
   * answered every `tools/call` with JSON_RPC_METHOD_NOT_FOUND, so even a
   * fully-populated registry could never actually be invoked.
   */
  it("INVOKES a registered tool through tools/call and returns its handler's content", async () => {
    const responses = await converse(probeRegistry(), [
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "probe.echo", arguments: { value: "hello" } },
      },
    ]);

    const called = responses.get(3)!.result as { content: { type: string; text: string }[] };
    expect(called.content).toEqual([{ type: "text", text: "echoed:hello" }]);
  });

  it("rejects a call whose arguments violate the tool's own schema, rather than invoking the handler", async () => {
    const responses = await converse(probeRegistry(), [
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "probe.echo", arguments: { value: 42 } },
      },
    ]);

    const message = responses.get(4)!;
    const failed =
      message.error !== undefined || (message.result as { isError?: boolean } | undefined)?.isError;
    expect(failed).toBeTruthy();
  });

  it("boots against an empty registry without crashing", async () => {
    const responses = await converse(new GatewayToolRegistry(), [
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
    ]);

    expect((responses.get(5)!.result as { tools: unknown[] }).tools).toEqual([]);
  });
});

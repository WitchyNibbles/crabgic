/**
 * roadmap/09-cli-and-doctor.md work item 2 / Exit criteria, `gateway-mcp.boot.test`:
 * "booting against an empty registry lists zero tools without crashing;
 * registering a fake tool makes it visible over stdio to a stub MCP
 * client." `PassThrough` streams stand in for real stdio.
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { createToolRegistry } from "./registry.js";
import { startGatewayMcpServer, type GatewayMcpServerHandle } from "./stdio-server.js";

interface StubMcpClient {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

function createStubMcpClient(input: PassThrough, output: PassThrough): StubMcpClient {
  let buffer = "";
  const pending = new Map<
    string | number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();

  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        const message = JSON.parse(line) as {
          id: string | number;
          result?: Record<string, unknown>;
          error?: { code: number; message: string };
        };
        const entry = pending.get(message.id);
        if (entry !== undefined) {
          pending.delete(message.id);
          if (message.error !== undefined) {
            entry.reject(new Error(message.error.message));
          } else {
            entry.resolve(message.result ?? {});
          }
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    close() {
      input.end();
    },
  };
}

let handle: GatewayMcpServerHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
});

describe("startGatewayMcpServer", () => {
  it("boots against an empty registry and lists zero tools without crashing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });
    const client = createStubMcpClient(input, output);

    const result = await client.request("tools/list");
    expect(result.tools).toEqual([]);
    client.close();
  });

  it("makes a registered fake tool visible over stdio to a stub MCP client", async () => {
    const registry = createToolRegistry();
    registry.register({ name: "fake.tool", description: "a fake tool", inputSchema: {} });

    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry, input, output });
    const client = createStubMcpClient(input, output);

    const result = await client.request("tools/list");
    expect(result.tools).toEqual([
      { name: "fake.tool", description: "a fake tool", inputSchema: {} },
    ]);
    client.close();
  });

  it("responds to initialize with the GATEWAY_MCP_SERVER_NAME identity", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });
    const client = createStubMcpClient(input, output);

    const result = await client.request("initialize");
    expect((result.serverInfo as { name: string }).name).toBe(GATEWAY_MCP_SERVER_NAME);
    client.close();
  });

  it("returns a JSON-RPC error for an unknown method, without crashing the connection", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });
    const client = createStubMcpClient(input, output);

    await expect(client.request("bogus/method")).rejects.toThrow();
    // Still alive afterward.
    const result = await client.request("tools/list");
    expect(result.tools).toEqual([]);
    client.close();
  });

  it("preserves the request id in a parse-error response when the shape is invalid but an id is present", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });

    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: "req-42", method: 123 })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const parsed = JSON.parse(chunks.join("")) as { id: string };
    expect(parsed.id).toBe("req-42");
  });

  it("defaults the id to 0 in a parse-error response when the malformed message carries no id at all", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });

    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
    input.write(`${JSON.stringify({ notEvenClose: true })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const parsed = JSON.parse(chunks.join("")) as { id: number };
    expect(parsed.id).toBe(0);
  });

  it("adversarial-review regression guard: an oversized, newline-less frame is rejected and the connection stopped, never buffered without bound", async () => {
    const { MAX_LINE_BYTES } = await import("@eo/supervisor");
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });

    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    const oversized = `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":${"z".repeat(MAX_LINE_BYTES + 100)}}`;
    input.write(oversized); // deliberately no trailing newline

    const closedOrTimedOut = await Promise.race([
      handle.closed.then(() => "closed" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    expect(closedOrTimedOut).toBe("closed");

    const written = chunks.join("");
    expect(written.length).toBeGreaterThan(0);
    const parsed = JSON.parse(written.trim()) as { error?: { message: string } };
    expect(parsed.error?.message).toContain("oversized line rejected");
  });

  it("tolerates a malformed (non-JSON) line without crashing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry: createToolRegistry(), input, output });
    const client = createStubMcpClient(input, output);

    input.write("not even json\n");
    const result = await client.request("tools/list");
    expect(result.tools).toEqual([]);
    client.close();
  });
});

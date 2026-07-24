/**
 * roadmap/12 exit criterion: "`capability.audit`/`capability.approve`
 * resolve over the shared `eo_gateway` registry against a stub MCP
 * client." Reuses 09's real `createToolRegistry`/`startGatewayMcpServer`
 * (`engineering-orchestrator`) — this is the SAME registry/stdio-server
 * `gateway mcp` boots in production, not a reimplementation.
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  createToolRegistry,
  startGatewayMcpServer,
  type GatewayMcpServerHandle,
} from "engineering-orchestrator";
import {
  CAPABILITY_AUDIT_TOOL,
  CAPABILITY_APPROVE_TOOL,
  registerCapabilityTools,
} from "./tool-definitions.js";

interface StubMcpClient {
  request(method: string): Promise<{ tools?: readonly { name: string }[] }>;
  close(): void;
}

function createStubMcpClient(input: PassThrough, output: PassThrough): StubMcpClient {
  let buffer = "";
  const pending = new Map<number, (v: { tools?: readonly { name: string }[] }) => void>();
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        const message = JSON.parse(line) as {
          id: number;
          result?: { tools?: readonly { name: string }[] };
        };
        pending.get(message.id)?.(message.result ?? {});
        pending.delete(message.id);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
  let nextId = 1;
  return {
    request(method) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`);
      });
    },
    close() {
      input.end();
    },
  };
}

describe("capability.audit / capability.approve — registered into the shared eo_gateway registry", () => {
  let handle: GatewayMcpServerHandle | undefined;
  afterEach(() => {
    handle?.stop();
  });

  it("both tools are visible over stdio tools/list to a stub MCP client", async () => {
    const registry = createToolRegistry();
    registerCapabilityTools(registry);

    const input = new PassThrough();
    const output = new PassThrough();
    handle = startGatewayMcpServer({ registry, input, output });
    const client = createStubMcpClient(input, output);

    const result = await client.request("tools/list");
    const names = (result.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(["capability.approve", "capability.audit"]);
    client.close();
  });

  it("registering both tools twice into the same registry throws (duplicate-name rejection, 09's own registry semantics)", () => {
    const registry = createToolRegistry();
    registerCapabilityTools(registry);
    expect(() => registerCapabilityTools(registry)).toThrow();
  });

  it("tool descriptors declare a non-empty description and a required-field input schema", () => {
    for (const tool of [CAPABILITY_AUDIT_TOOL, CAPABILITY_APPROVE_TOOL]) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema["required"]).toBeDefined();
    }
  });
});

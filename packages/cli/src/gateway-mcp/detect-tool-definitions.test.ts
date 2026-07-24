/**
 * roadmap/12 exit criterion: "`capability.audit`/`capability.approve`
 * resolve over the shared `GATEWAY_MCP_SERVER_NAME` registry against a stub MCP
 * client." Reuses 09's real `createToolRegistry`/`startGatewayMcpServer`
 * — this is the SAME registry/stdio-server `gateway mcp` boots in
 * production, not a reimplementation.
 *
 * Lives in `packages/cli` rather than `packages/detect` (2026-07-25): it is
 * an integration test across the 09/12 seam, and it is the composition side
 * that owns both halves. Keeping it in `packages/detect` would have forced
 * that package to depend on the CLI's stdio server, closing the
 * `cli -> learning -> gates -> detect -> cli` cycle this relocation broke.
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAPABILITY_AUDIT_TOOL,
  CAPABILITY_APPROVE_TOOL,
  registerCapabilityTools,
} from "@eo/detect";
import { createToolRegistry } from "./registry.js";
import { startGatewayMcpServer, type GatewayMcpServerHandle } from "./stdio-server.js";

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

describe("capability.audit / capability.approve — registered into the shared GATEWAY_MCP_SERVER_NAME registry", () => {
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

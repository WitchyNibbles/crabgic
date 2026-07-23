import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GatewayToolRegistry } from "./tool-registry.js";
import { buildGatewayMcpServer, connectGatewayMcpServer } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "test-support", "stdio-boot-fixture.mjs");

const NATIVE_TOOL_NAMES = [
  "tracker.search",
  "tracker.get",
  "tracker.plan_create",
  "tracker.plan_update",
  "tracker.plan_transition",
  "tracker.plan_comment",
  "tracker.apply",
  "observability.search",
  "observability.get",
  "observability.query",
  "observability.plan_create",
  "observability.plan_update",
  "observability.apply",
  "evidence.attach",
  "evidence.get",
  "result.submit",
  "run.status",
  "run.cancel",
];

describe("buildGatewayMcpServer — unit", () => {
  it("booting against an empty registry produces a well-formed server, no crash", () => {
    const registry = new GatewayToolRegistry();
    const server = buildGatewayMcpServer(registry);
    expect(server.isConnected()).toBe(false);
  });
});

describe("buildGatewayMcpServer + connectGatewayMcpServer — in-process (real callback body coverage)", () => {
  it("a successful tool call round-trips with no isError field", async () => {
    const registry = new GatewayToolRegistry();
    registry.register({
      name: "fixture.echo",
      description: "echoes back its input",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const server = buildGatewayMcpServer(registry);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "in-process-client", version: "0.0.0" });

    await Promise.all([connectGatewayMcpServer(server, serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "fixture.echo", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    } finally {
      await client.close();
    }
  });

  it("a failed tool call (isError: true) round-trips with isError set", async () => {
    const registry = new GatewayToolRegistry();
    registry.register({
      name: "fixture.fail",
      description: "always fails",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
    });
    const server = buildGatewayMcpServer(registry);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "in-process-client", version: "0.0.0" });

    await Promise.all([connectGatewayMcpServer(server, serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "fixture.fail", arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("the gateway MCP server — stdio boot to a stub MCP client", () => {
  let journalDir: string;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-gateway-stdio-boot-"));
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  it("lists exactly this phase's native tool set over stdio to a stub MCP client", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [FIXTURE],
      env: { EO_FIXTURE_JOURNAL_DIR: journalDir },
    });
    const client = new Client({ name: "stub-mcp-client", version: "0.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...NATIVE_TOOL_NAMES].sort());
    } finally {
      await client.close();
    }
  });

  it("accepts one externally-registered tool with no name collision — the registration API is genuinely extensible", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [FIXTURE],
      env: { EO_FIXTURE_JOURNAL_DIR: journalDir, EO_FIXTURE_REGISTER_EXTRA_TOOL: "1" },
    });
    const client = new Client({ name: "stub-mcp-client", version: "0.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("project.inspect");
      expect(names.sort()).toEqual([...NATIVE_TOOL_NAMES, "project.inspect"].sort());
    } finally {
      await client.close();
    }
  });

  it("calling a native tool over stdio round-trips through the real handler", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [FIXTURE],
      env: { EO_FIXTURE_JOURNAL_DIR: journalDir },
    });
    const client = new Client({ name: "stub-mcp-client", version: "0.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "evidence.attach",
        arguments: {
          changeSetId: "11111111-1111-4111-8111-111111111111",
          command: "npm test",
          exitStatus: 0,
          toolchainFingerprint: "node-24",
          artifactDigests: ["sha256:abc"],
          objectId: "deadbeef",
        },
      });
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });

  it("calling a native tool over stdio surfaces isError:true for a failed dispatch", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [FIXTURE],
      env: { EO_FIXTURE_JOURNAL_DIR: journalDir },
    });
    const client = new Client({ name: "stub-mcp-client", version: "0.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "tracker.search",
        arguments: { connectionId: "00000000-0000-4000-8000-000000000000", params: {} },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

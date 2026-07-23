import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import {
  UpstreamMcpClientPolicyStore,
  buildSimulatedWorkerMcpServers,
} from "./upstream-mcp-client-policy.js";

describe("UpstreamMcpClientPolicyStore", () => {
  it("defaults every connection to disabled (REST remains primary and default)", () => {
    const store = new UpstreamMcpClientPolicyStore();
    expect(store.isEnabled("conn-1")).toBe(false);
  });

  it("tracks an explicit per-connection enable/disable", () => {
    const store = new UpstreamMcpClientPolicyStore();
    store.setEnabled("conn-1", true);
    expect(store.isEnabled("conn-1")).toBe(true);
    expect(store.isEnabled("conn-2")).toBe(false);

    store.setEnabled("conn-1", false);
    expect(store.isEnabled("conn-1")).toBe(false);
  });
});

describe("exit criterion — upstream-MCP-client wrap never adds a worker-visible MCP server", () => {
  it("a simulated worker's mcpServers config contains exactly one entry, keyed by GATEWAY_MCP_SERVER_NAME", () => {
    const mcpServers = buildSimulatedWorkerMcpServers();
    expect(Object.keys(mcpServers)).toEqual([GATEWAY_MCP_SERVER_NAME]);
  });

  it("enabling the upstream-MCP-client flag for a fixture connection changes nothing about the worker-visible mcpServers set", () => {
    const store = new UpstreamMcpClientPolicyStore();
    const before = buildSimulatedWorkerMcpServers();

    store.setEnabled("fixture-connection-1", true);
    const after = buildSimulatedWorkerMcpServers();

    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(Object.keys(after)).toEqual([GATEWAY_MCP_SERVER_NAME]);
    expect(store.isEnabled("fixture-connection-1")).toBe(true);
  });
});

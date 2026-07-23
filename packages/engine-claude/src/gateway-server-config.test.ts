import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { buildGatewayMcpServers } from "./gateway-server-config.js";

/**
 * `gateway-server-config` (roadmap/06-claude-engine-adapter.md §In scope,
 * "Gateway wiring (Gap 11, Gap 2)"; interface-ledger Gap 2's exact argv:
 * `{"command": "engineering-orchestrator", "args": ["gateway", "mcp"]}`).
 * Keyed by `GATEWAY_MCP_SERVER_NAME` (Gap 11) — never a hand-typed literal
 * of that constant's value (see `./gateway-name-reference.test.ts` for the
 * within-this-package scan).
 */
describe("buildGatewayMcpServers", () => {
  it("keys the returned record by GATEWAY_MCP_SERVER_NAME", () => {
    const servers = buildGatewayMcpServers();
    expect(Object.keys(servers)).toEqual([GATEWAY_MCP_SERVER_NAME]);
  });

  it("defaults to the external 'engineering-orchestrator gateway mcp' stdio process (ledger Gap 2)", () => {
    const servers = buildGatewayMcpServers();
    expect(servers[GATEWAY_MCP_SERVER_NAME]).toEqual({
      type: "stdio",
      command: "engineering-orchestrator",
      args: ["gateway", "mcp"],
    });
  });

  it("an override replaces only the entry VALUE, never the key", () => {
    const override = { type: "stdio", command: "stub-gateway", args: ["--fixture"] } as const;
    const servers = buildGatewayMcpServers(override);
    expect(Object.keys(servers)).toEqual([GATEWAY_MCP_SERVER_NAME]);
    expect(servers[GATEWAY_MCP_SERVER_NAME]).toEqual(override);
  });

  it("passing undefined explicitly still yields the default entry", () => {
    const servers = buildGatewayMcpServers(undefined);
    expect(servers[GATEWAY_MCP_SERVER_NAME]).toEqual({
      type: "stdio",
      command: "engineering-orchestrator",
      args: ["gateway", "mcp"],
    });
  });
});

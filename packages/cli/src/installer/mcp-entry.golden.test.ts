/**
 * roadmap/10-plugin-and-installer.md exit criterion: "`.mcp.json`
 * project-scope entry key equals `GATEWAY_MCP_SERVER_NAME` and its command
 * equals `engineering-orchestrator gateway mcp`, byte-for-byte — golden
 * test `mcp-entry.golden.test`." Work item 2's first failing test: "a
 * golden-file comparison of the generated `.mcp.json` entry against the
 * literal `{"GATEWAY_MCP_SERVER_NAME": {"command": "engineering-orchestrator", "args":
 * ["gateway", "mcp"]}}` shape."
 *
 * This file never hand-types the `"GATEWAY_MCP_SERVER_NAME"` literal (this repo's
 * sole-definition-site scanner, `@eo/contracts`'s `server-name.test.ts`,
 * forbids it anywhere under `packages/*\/src`) — the golden shape below is
 * built with `GATEWAY_MCP_SERVER_NAME` as a computed property key, which is
 * byte-identical JSON to the hand-typed ledger literal once serialized.
 */
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { buildGatewayMcpServerEntry, mergeMcpJson } from "./mcp-json-merge.js";

describe("mcp-entry.golden.test", () => {
  it("the merged .mcp.json entry, keyed GATEWAY_MCP_SERVER_NAME, is byte-for-byte the ledger's literal shape", () => {
    const result = mergeMcpJson({});
    expect(result.mcpJson).toEqual({
      mcpServers: {
        [GATEWAY_MCP_SERVER_NAME]: {
          command: "engineering-orchestrator",
          args: ["gateway", "mcp"],
        },
      },
    });
    // Byte-for-byte JSON comparison against the ledger's exact literal text
    // (ledger: `{"GATEWAY_MCP_SERVER_NAME": {"command": "engineering-orchestrator", "args": ["gateway", "mcp"]}}`),
    // reconstructed here only via the imported constant, never re-typed.
    const expectedJson = JSON.stringify({
      [GATEWAY_MCP_SERVER_NAME]: { command: "engineering-orchestrator", args: ["gateway", "mcp"] },
    });
    expect(JSON.stringify(result.mcpJson.mcpServers)).toBe(expectedJson);
  });

  it("buildGatewayMcpServerEntry() is exactly {command, args} with no extra fields", () => {
    expect(buildGatewayMcpServerEntry()).toEqual({
      command: "engineering-orchestrator",
      args: ["gateway", "mcp"],
    });
    expect(Object.keys(buildGatewayMcpServerEntry())).toEqual(["command", "args"]);
  });

  it("is idempotent and preserves other configured MCP servers, add-only", () => {
    const existing = { mcpServers: { "some-other-server": { command: "foo", args: [] } } };
    const first = mergeMcpJson(existing);
    expect(first.changed).toBe(true);
    const second = mergeMcpJson(first.mcpJson);
    expect(second.changed).toBe(false);
    expect((second.mcpJson.mcpServers as Record<string, unknown>)["some-other-server"]).toEqual({
      command: "foo",
      args: [],
    });
  });

  it("never overwrites an already-present entry under GATEWAY_MCP_SERVER_NAME, even a different one", () => {
    const existing = {
      mcpServers: { [GATEWAY_MCP_SERVER_NAME]: { command: "custom", args: ["x"] } },
    };
    const result = mergeMcpJson(existing);
    expect(result.changed).toBe(false);
    expect((result.mcpJson.mcpServers as Record<string, unknown>)[GATEWAY_MCP_SERVER_NAME]).toEqual(
      {
        command: "custom",
        args: ["x"],
      },
    );
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24, CONFIRMED): never clobbers a present-but-non-object mcpServers value (a string)", () => {
    const existing = { mcpServers: "not-an-object" };
    const result = mergeMcpJson(existing);
    expect(result.mcpJson.mcpServers).toBe("not-an-object");
    expect(result.changed).toBe(false);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24): never clobbers a present-but-non-object mcpServers value (an array)", () => {
    const existing = { mcpServers: ["not", "a", "map"] };
    const result = mergeMcpJson(existing);
    expect(result.mcpJson.mcpServers).toEqual(["not", "a", "map"]);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24): never clobbers a present-but-null mcpServers value", () => {
    const existing = { mcpServers: null };
    const result = mergeMcpJson(existing);
    expect(result.mcpJson.mcpServers).toBeNull();
  });
});

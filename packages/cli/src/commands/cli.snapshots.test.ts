/**
 * roadmap/09-cli-and-doctor.md §Test plan, Conformance: "snapshot tests for
 * help text and every `--json` output schema, including `gateway mcp`'s
 * tool-listing shape; `gateway mcp`'s stdio boot invocation is
 * byte-compared against the exact string 10's `.mcp.json` entry uses
 * (`engineering-orchestrator gateway mcp`)." Exit criterion `cli.snapshots.test`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCommand } from "../argv/parse-command.js";
import { createToolRegistry } from "../gateway-mcp/registry.js";
import { buildNotImplementedShape } from "./not-implemented.js";
import { BINARY_NAME, COMMAND_HELP, renderHelp } from "./help.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("help text snapshots", () => {
  it("top-level help (human) is snapshot-stable", () => {
    const result = renderHelp({ command: "help", json: false });
    expect(result.stdout).toMatchSnapshot();
  });

  it("top-level help (--json) is snapshot-stable", () => {
    const result = renderHelp({ command: "help", json: true });
    expect(result.stdout).toMatchSnapshot();
  });

  it("topic help for every declared command is snapshot-stable", () => {
    for (const topic of Object.keys(COMMAND_HELP)) {
      const result = renderHelp({ command: "help", json: false, topic });
      expect(result.stdout).toMatchSnapshot(`topic-${topic}`);
    }
  });

  it("gateway mcp has its own help entry", () => {
    expect(COMMAND_HELP["gateway"]?.usage).toBe(`${BINARY_NAME} gateway mcp`);
  });
});

describe("--json output schema snapshots", () => {
  it("NOT_IMPLEMENTED shape is snapshot-stable", () => {
    expect(buildNotImplementedShape("install")).toMatchSnapshot();
  });

  it("gateway mcp's tool-listing shape (empty registry) is snapshot-stable", () => {
    expect({ tools: createToolRegistry().list() }).toMatchSnapshot();
  });

  it("gateway mcp's tool-listing shape (one registered tool) is snapshot-stable", () => {
    const registry = createToolRegistry();
    registry.register({
      name: "tracker.search",
      description: "Search the tracker.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    });
    expect({ tools: registry.list() }).toMatchSnapshot();
  });
});

describe("gateway mcp — exact stdio boot invocation (byte-compared against 10's .mcp.json entry)", () => {
  it('parses ["gateway", "mcp"] to the gateway-mcp command with no flags', () => {
    expect(parseCommand(["gateway", "mcp"])).toEqual({ command: "gateway-mcp" });
  });

  it('BINARY_NAME is exactly "engineering-orchestrator"', () => {
    expect(BINARY_NAME).toBe("engineering-orchestrator");
  });

  it('the exact invocation string "engineering-orchestrator gateway mcp" round-trips through this package\'s own argv split', () => {
    const invocation = `${BINARY_NAME} gateway mcp`;
    const [, ...argv] = invocation.split(" ");
    expect(parseCommand(argv)).toEqual({ command: "gateway-mcp" });
  });

  it("package.json's own bin entry is keyed exactly BINARY_NAME — the literal 10's .mcp.json command field must match", async () => {
    const raw = await readFile(join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { readonly bin?: Record<string, string> };
    expect(pkg.bin).toEqual({ [BINARY_NAME]: "./dist/bin.js" });
  });
});

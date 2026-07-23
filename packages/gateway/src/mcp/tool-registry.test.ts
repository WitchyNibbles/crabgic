import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DuplicateToolNameError, GatewayToolRegistry } from "./tool-registry.js";

describe("GatewayToolRegistry", () => {
  it("boots with a well-formed, empty tool set — no native handler wired yet", () => {
    const registry = new GatewayToolRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.toolNames).toEqual([]);
  });

  it("registers and lists a tool", async () => {
    const registry = new GatewayToolRegistry();
    registry.register({
      name: "tracker.search",
      description: "search tracker items",
      inputSchema: { query: z.string() },
      handler: async (args) => ({ content: [{ type: "text", text: `searched: ${args.query}` }] }),
    });

    expect(registry.toolNames).toEqual(["tracker.search"]);
    const tool = registry.get("tracker.search");
    expect(tool).toBeDefined();
    const result = await tool?.handler({ query: "foo" });
    expect(result?.content[0]?.text).toBe("searched: foo");
  });

  it("rejects a duplicate-name registration attempt before the check exists elsewhere", () => {
    const registry = new GatewayToolRegistry();
    registry.register({
      name: "tracker.search",
      description: "search",
      inputSchema: {},
      handler: async () => ({ content: [] }),
    });

    expect(() =>
      registry.register({
        name: "tracker.search",
        description: "a different implementation",
        inputSchema: {},
        handler: async () => ({ content: [] }),
      }),
    ).toThrow(DuplicateToolNameError);
  });

  it("get returns undefined for an unregistered name", () => {
    const registry = new GatewayToolRegistry();
    expect(registry.get("does.not.exist")).toBeUndefined();
  });

  it("accepts an externally-registered tool alongside native ones with no collision", () => {
    const registry = new GatewayToolRegistry();
    registry.register({
      name: "tracker.search",
      description: "native",
      inputSchema: {},
      handler: async () => ({ content: [] }),
    });
    registry.register({
      name: "project.inspect", // an 11-owned tool, registered independently
      description: "external",
      inputSchema: {},
      handler: async () => ({ content: [] }),
    });

    expect([...registry.toolNames].sort()).toEqual(["project.inspect", "tracker.search"]);
  });
});

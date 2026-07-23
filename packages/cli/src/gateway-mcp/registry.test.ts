import { describe, expect, it } from "vitest";
import { createToolRegistry, DuplicateToolError } from "./registry.js";

describe("createToolRegistry", () => {
  it("lists zero tools for a freshly-created registry", () => {
    expect(createToolRegistry().list()).toEqual([]);
  });

  it("registers and lists a fake tool", () => {
    const registry = createToolRegistry();
    registry.register({ name: "fake.tool", description: "a fake tool", inputSchema: {} });
    expect(registry.list()).toEqual([
      { name: "fake.tool", description: "a fake tool", inputSchema: {} },
    ]);
    expect(registry.get("fake.tool")?.name).toBe("fake.tool");
  });

  it("rejects a duplicate tool-name registration", () => {
    const registry = createToolRegistry();
    registry.register({ name: "fake.tool", description: "d", inputSchema: {} });
    expect(() => registry.register({ name: "fake.tool", description: "d2", inputSchema: {} })).toThrow(
      DuplicateToolError,
    );
    // The original registration is unaffected by the rejected duplicate.
    expect(registry.list()).toHaveLength(1);
  });
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePluginRoot } from "./plugin-root.js";

describe("resolvePluginRoot", () => {
  it("resolves to this package's own root (containing .claude-plugin/plugin.json)", () => {
    const root = resolvePluginRoot();
    expect(existsSync(join(root, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(root, "skills"))).toBe(true);
    expect(existsSync(join(root, "agents"))).toBe(true);
    expect(existsSync(join(root, "hooks", "hooks.json"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { ENABLED_PLUGIN_KEY } from "./enabled-plugin-key.js";
import { PLUGIN_CAPABILITY_NAME } from "./capability-entry.js";
import { MARKETPLACE_NAME } from "./marketplace-schema.js";
import { loadMarketplace } from "./marketplace-schema.js";
import { resolvePluginRoot } from "./plugin-root.js";

describe("ENABLED_PLUGIN_KEY — live-verified against a real claude 2.1.218 binary", () => {
  it('is the golden, live-verified value "engineering-orchestrator@engineering-orchestrator-marketplace"', () => {
    expect(ENABLED_PLUGIN_KEY).toBe(
      "engineering-orchestrator@engineering-orchestrator-marketplace",
    );
  });

  it("is composed from PLUGIN_CAPABILITY_NAME and MARKETPLACE_NAME, never a second hand-typed literal", () => {
    expect(ENABLED_PLUGIN_KEY).toBe(`${PLUGIN_CAPABILITY_NAME}@${MARKETPLACE_NAME}`);
  });

  it("MARKETPLACE_NAME matches this package's own real, committed marketplace.json name field (freshness)", () => {
    const marketplace = loadMarketplace(resolvePluginRoot());
    expect(MARKETPLACE_NAME).toBe(marketplace.name);
  });

  it("PLUGIN_CAPABILITY_NAME matches the real marketplace.json's plugin entry name (freshness)", () => {
    const marketplace = loadMarketplace(resolvePluginRoot());
    expect(PLUGIN_CAPABILITY_NAME).toBe(marketplace.plugins[0]!.name);
  });
});

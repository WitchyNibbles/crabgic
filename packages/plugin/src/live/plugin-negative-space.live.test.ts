/**
 * roadmap/10-plugin-and-installer.md work item 9's own first-failing-test
 * framing: "the `@live` smoke assertion, run before the plugin is
 * installed, correctly reports skills/agents absent (sanity-checks the
 * assertion itself before the plugin exists to install)." This file proves
 * `probePluginInventory` reports absence correctly BEFORE any
 * `--plugin-dir`/install has happened — the negative-space half of
 * `plugin.live-smoke`, and a prerequisite for trusting the positive half in
 * `./plugin-load.live.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { assertLiveEnabled } from "./live-gate.js";
import { probePluginInventory } from "./plugin-inventory-probe.js";
import { PLUGIN_CAPABILITY_NAME } from "../capability-entry.js";

describe("@live plugin.live-smoke — negative space (before install)", () => {
  it("reports the plugin absent (no --plugin-dir, not otherwise installed): zero skills/agents/mcp servers", async () => {
    assertLiveEnabled();
    const inventory = await probePluginInventory({ pluginName: PLUGIN_CAPABILITY_NAME });
    expect(inventory.found).toBe(false);
    expect(inventory.skills).toEqual([]);
    expect(inventory.agents).toEqual([]);
    expect(inventory.mcpServers).toEqual([]);
  });
});

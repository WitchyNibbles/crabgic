/**
 * The committed `.claude-plugin/plugin.json` must NOT declare `version`.
 *
 * Engine fact (`docs/engine-baseline.md` §16, accepted range 2.1.207–2.1.220):
 * a plugin's effective version resolves `plugin.json` → marketplace entry →
 * source commit SHA, and when both declare one, Claude Code takes the
 * `plugin.json` value **without warning**. This package ships the release
 * version in the marketplace entry, which the release preparer recomputes at
 * every release (`e2e/release/src/marketplaceEntryPreparer.ts`). A `version`
 * left in the manifest silently outranks it and pins every installed copy to
 * that string — the state this repository shipped in 1.0.0/1.0.1, where the
 * manifest's `"0.0.0"` overrode the entry's real release version.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUnpinnedMarketplace } from "./marketplace-schema.js";
import { resolvePluginRoot } from "./plugin-root.js";

function readPluginManifest(): Record<string, unknown> {
  const raw = readFileSync(join(resolvePluginRoot(), ".claude-plugin", "plugin.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("plugin.json version — must not shadow the marketplace entry", () => {
  it("declares no `version` key at all, so the marketplace entry governs", () => {
    expect(readPluginManifest()).not.toHaveProperty("version");
  });

  it("still declares `name`, the one field the manifest schema requires", () => {
    expect(readPluginManifest().name).toBe("crabgic");
  });

  it("leaves the marketplace entry as the sole declared version", () => {
    const entry = loadUnpinnedMarketplace(resolvePluginRoot()).plugins[0]!;
    expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(readPluginManifest().version).toBeUndefined();
  });
});

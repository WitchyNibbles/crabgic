import { describe, expect, it } from "vitest";
import { TESTED_ENGINE_VERSION } from "@eo/engine-claude";
import {
  buildEngineCapabilityEntry,
  buildPluginCapabilityEntry,
  PLUGIN_CAPABILITY_NAME,
} from "./capability-entry.js";
import { resolvePluginRoot } from "./plugin-root.js";
import { computeContentDigest } from "./content-digest.js";

describe("buildPluginCapabilityEntry", () => {
  it("builds a schema-valid, digest-pinned, pending plugin entry", () => {
    const entry = buildPluginCapabilityEntry({ pluginRoot: resolvePluginRoot() });
    expect(entry).toEqual({
      kind: "plugin",
      name: PLUGIN_CAPABILITY_NAME,
      digest: computeContentDigest(resolvePluginRoot()),
      decision: "pending",
    });
  });

  it("carries an optional sourceRef (e.g. a marketplace commit SHA) when supplied", () => {
    const entry = buildPluginCapabilityEntry({
      pluginRoot: resolvePluginRoot(),
      sourceRef: "a".repeat(40),
    });
    expect(entry.sourceRef).toBe("a".repeat(40));
  });
});

describe("buildEngineCapabilityEntry", () => {
  it("reuses @eo/engine-claude's TESTED_ENGINE_VERSION and capability booleans, not a re-derived constant", () => {
    const entry = buildEngineCapabilityEntry();
    expect(entry).toEqual({
      kind: "engine",
      engineVersion: TESTED_ENGINE_VERSION,
      supportsJsonSchema: true,
      supportsSessionResume: true,
    });
  });
});

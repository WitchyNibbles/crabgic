import { describe, expect, it } from "vitest";
import { mergeSettingsJson } from "./settings-merge.js";

const PLUGIN = "engineering-orchestrator";

describe("mergeSettingsJson — add-only defaults", () => {
  it("adds attribution, sessionUrl, and enabledPlugins to a brand-new (empty) settings object", () => {
    const result = mergeSettingsJson({}, PLUGIN);
    expect(result.changed).toBe(true);
    expect(result.settings).toEqual({
      attribution: { commit: "", pr: "" },
      sessionUrl: false,
      enabledPlugins: { [PLUGIN]: true },
    });
  });

  it("is idempotent: merging twice in a row is a no-op the second time", () => {
    const first = mergeSettingsJson({}, PLUGIN).settings;
    const second = mergeSettingsJson(first, PLUGIN);
    expect(second.changed).toBe(false);
    expect(second.settings).toEqual(first);
  });
});

describe("mergeSettingsJson — monotonicity: never touches a key already present", () => {
  it("never overwrites a pre-existing attribution value, even a non-empty one", () => {
    const existing = { attribution: { commit: "abc123", pr: "42" } };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.attribution).toEqual({ commit: "abc123", pr: "42" });
  });

  it("never overwrites a pre-existing sessionUrl value", () => {
    const existing = { sessionUrl: true };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.sessionUrl).toBe(true);
  });

  it("preserves other plugins already present in enabledPlugins", () => {
    const existing = { enabledPlugins: { "some-other-plugin": true } };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toEqual({
      "some-other-plugin": true,
      [PLUGIN]: true,
    });
  });

  it("never re-enables this plugin's own enabledPlugins entry if the user explicitly disabled it (security: a crafted attempt to widen enabledPlugins is rejected)", () => {
    const existing = {
      attribution: { commit: "", pr: "" },
      sessionUrl: false,
      enabledPlugins: { [PLUGIN]: false },
    };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toEqual({ [PLUGIN]: false });
    // Every add-only key was already present — nothing at all changes.
    expect(result.changed).toBe(false);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24, CONFIRMED): never clobbers a present-but-non-object enabledPlugins value (a string)", () => {
    const existing = {
      attribution: { commit: "", pr: "" },
      sessionUrl: false,
      enabledPlugins: "foo",
    };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toBe("foo");
    // Every add-only key was already present (even if enabledPlugins is the
    // "wrong" type) — nothing at all changes, PoC from the finding: this
    // used to silently become `{"engineering-orchestrator": true}`.
    expect(result.changed).toBe(false);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24): never clobbers a present-but-non-object enabledPlugins value (an array)", () => {
    const existing = { enabledPlugins: ["not", "a", "map"] };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toEqual(["not", "a", "map"]);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24): never clobbers a present-but-null enabledPlugins value", () => {
    const existing = { enabledPlugins: null };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toBeNull();
  });

  it("preserves every unrelated user-added top-level key untouched", () => {
    const existing = { someUserKey: { nested: true }, anotherKey: [1, 2, 3] };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.someUserKey).toEqual({ nested: true });
    expect(result.settings.anotherKey).toEqual([1, 2, 3]);
  });
});

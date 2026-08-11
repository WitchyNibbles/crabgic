import { describe, expect, it } from "vitest";
import { mergeSettingsJson } from "./settings-merge.js";
import { STATUSLINE_SETTINGS_ENTRY } from "./statusline-writer.js";
import { OUTPUT_STYLE_SETTINGS_VALUE } from "./output-style-writer.js";

const PLUGIN = "crabgic";

/** Every add-only key already at its installed value — the "nothing left to add" fixture. */
const FULLY_INSTALLED = {
  attribution: { commit: "", pr: "" },
  sessionUrl: false,
  statusLine: { ...STATUSLINE_SETTINGS_ENTRY },
  outputStyle: OUTPUT_STYLE_SETTINGS_VALUE,
};

describe("mergeSettingsJson — add-only defaults", () => {
  it("adds attribution, sessionUrl, statusLine, outputStyle and enabledPlugins to a brand-new (empty) settings object", () => {
    const result = mergeSettingsJson({}, PLUGIN);
    expect(result.changed).toBe(true);
    expect(result.settings).toEqual({
      ...FULLY_INSTALLED,
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

  it("never replaces a status line the user already configured", () => {
    // Overwriting someone's own status line is the display-layer equivalent
    // of loosening a key they set deliberately: it silently removes output
    // they chose to see.
    const existing = { statusLine: { type: "command", command: "~/bin/my-own-statusline.sh" } };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.statusLine).toEqual({
      type: "command",
      command: "~/bin/my-own-statusline.sh",
    });
  });

  it("never revives a status line the user deliberately blanked out or disabled", () => {
    for (const disabled of [null, false, {}]) {
      const result = mergeSettingsJson({ statusLine: disabled }, PLUGIN);
      expect(result.settings.statusLine).toEqual(disabled);
    }
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
      ...FULLY_INSTALLED,
      enabledPlugins: { [PLUGIN]: false },
    };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toEqual({ [PLUGIN]: false });
    // Every add-only key was already present — nothing at all changes.
    expect(result.changed).toBe(false);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24, CONFIRMED): never clobbers a present-but-non-object enabledPlugins value (a string)", () => {
    const existing = {
      ...FULLY_INSTALLED,
      enabledPlugins: "foo",
    };
    const result = mergeSettingsJson(existing, PLUGIN);
    expect(result.settings.enabledPlugins).toBe("foo");
    // Every add-only key was already present (even if enabledPlugins is the
    // "wrong" type) — nothing at all changes, PoC from the finding: this
    // used to silently become `{"crabgic": true}`.
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

import { describe, expect, it } from "vitest";
import { buildOutputStyle, OUTPUT_STYLE_NAME } from "@crabgic/plugin";
import {
  loadOutputStyleFileToInstall,
  OUTPUT_STYLE_REL_PATH,
  OUTPUT_STYLE_SETTINGS_VALUE,
} from "./output-style-writer.js";
import { mergeSettingsJson } from "./settings-merge.js";

/**
 * The output style is a wholly-owned project artifact plus an ADD-ONLY settings
 * key — the shape `statusline-writer.ts` already uses, adopted because
 * `docs/engine-baseline.md` §23 measured that output styles are not a plugin
 * component (§17 having established the same for `statusLine`).
 *
 * The add-only half is the safety-critical one and gets the most tests: this
 * key changes the REGISTER of every session in the project, so clobbering an
 * operator's existing choice would be the communication equivalent of loosening
 * a security setting they made deliberately.
 */
describe("output style artifact", () => {
  it("lands under .claude/output-styles/ so the engine can resolve it by name", () => {
    expect(OUTPUT_STYLE_REL_PATH).toBe(".claude/output-styles/crabgic.md");
  });

  it("writes the generated style, not a copy that could drift from the policy", () => {
    expect(loadOutputStyleFileToInstall().content).toBe(buildOutputStyle());
  });

  it("names the style exactly as the settings value spells it", () => {
    expect(OUTPUT_STYLE_SETTINGS_VALUE).toBe(OUTPUT_STYLE_NAME);
    // A mismatch here would write a file the setting cannot resolve — inert,
    // and silently so, which is the worst shape this failure could take.
    expect(loadOutputStyleFileToInstall().content).toContain(
      `name: ${OUTPUT_STYLE_SETTINGS_VALUE}`,
    );
  });
});

describe("outputStyle is add-only", () => {
  it("sets the key on a fresh project", () => {
    const { settings, changed } = mergeSettingsJson({}, "crabgic");
    expect(settings.outputStyle).toBe(OUTPUT_STYLE_SETTINGS_VALUE);
    expect(changed).toBe(true);
  });

  it("NEVER replaces a style the operator already chose", () => {
    const { settings } = mergeSettingsJson({ outputStyle: "Explanatory" }, "crabgic");
    expect(settings.outputStyle).toBe("Explanatory");
  });

  it("respects a deliberately blank or null choice, which is still a choice", () => {
    expect(mergeSettingsJson({ outputStyle: "" }, "crabgic").settings.outputStyle).toBe("");
    expect(mergeSettingsJson({ outputStyle: null }, "crabgic").settings.outputStyle).toBeNull();
  });

  it("does not treat a wrong-typed existing value as absent", () => {
    // The monotonicity defect this repo already fixed once for `enabledPlugins`:
    // guarding on shape rather than PRESENCE let a present-but-odd value be
    // silently overwritten. Guarded on presence here from the start.
    const { settings } = mergeSettingsJson({ outputStyle: { name: "mine" } }, "crabgic");
    expect(settings.outputStyle).toEqual({ name: "mine" });
  });

  it("reports no change when every managed key is already present", () => {
    const first = mergeSettingsJson({}, "crabgic");
    const second = mergeSettingsJson(first.settings, "crabgic");
    expect(second.changed).toBe(false);
    expect(second.settings.outputStyle).toBe(OUTPUT_STYLE_SETTINGS_VALUE);
  });
});

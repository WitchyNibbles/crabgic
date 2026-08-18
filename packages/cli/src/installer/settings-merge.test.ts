import { describe, expect, it } from "vitest";
import { APPROVAL_DENY_RULES, mergeSettingsJson } from "./settings-merge.js";
import { STATUSLINE_SETTINGS_ENTRY } from "./statusline-writer.js";
import { OUTPUT_STYLE_SETTINGS_VALUE } from "./output-style-writer.js";

const PLUGIN = "crabgic";

/** Every add-only key already at its installed value — the "nothing left to add" fixture. */
const FULLY_INSTALLED = {
  attribution: { commit: "", pr: "" },
  sessionUrl: false,
  statusLine: { ...STATUSLINE_SETTINGS_ENTRY },
  outputStyle: OUTPUT_STYLE_SETTINGS_VALUE,
  // Added 2026-08-18 with the approval deny rules. Spread from the exported
  // constant rather than retyped: a literal copy here would be a second source
  // of truth for a security list this file does not own, and it would keep
  // passing while the real rules drifted.
  permissions: { deny: [...APPROVAL_DENY_RULES] },
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

/**
 * ⚠️ THE APPROVAL DENY RULES — owner ruling 2026-08-18, and the one place this
 * merge deliberately does NOT follow its own add-only rule.
 *
 * MEASURED, and it is why the ruling exists. `packages/cli/src/approval/prompt.ts`'s
 * `readConfirmation` reads one line from `io.input` and checks no TTY — its own
 * doc says "'yes' followed by end-of-input confirms" — and this repository's
 * `.claude/settings.json` declares no `permissions` block at all. So a manager
 * session could satisfy any approval gate by piping `yes` into the CLI. The
 * gates are documented as "a human act by design and which you can never
 * satisfy yourself"; against this agent they were procedural.
 *
 * The fix uses the primitive that already exists: a permission DENY is enforced
 * by the harness, not by the agent's cooperation, so the approval surface can
 * only be reached the way the ruling wants — asked in Claude Code, answered by
 * a person.
 *
 * ⚠️ HONEST BOUND, stated here rather than left for a reviewer to find. These
 * rules match COMMAND PREFIXES. They do not stop `npx crabgic …`, a direct
 * `node …/bin.js` invocation, or any other spelling of the same program. This
 * is defence in depth that raises the cost and removes the accidental path; it
 * is not a boundary, and `docs/deploy-posture.md` must not claim otherwise.
 */
describe("approval deny rules — tightening, and exempt from add-only", () => {
  it("adds every approval deny rule to a settings file that has no permissions block", () => {
    const { settings, changed } = mergeSettingsJson({}, PLUGIN);

    expect(changed).toBe(true);
    const deny = (settings["permissions"] as { deny?: string[] }).deny ?? [];
    for (const rule of APPROVAL_DENY_RULES) expect(deny).toContain(rule);
  });

  /**
   * ⚠️ THE EXCEPTION, and the whole point of this suite. Every other key here is
   * add-only: present means untouched. A `permissions` block that already exists
   * would therefore have kept the hole open forever. Monotonicity forbids
   * LOOSENING a security key; adding a deny is the opposite operation.
   */
  it("UNIONS into an existing permissions.deny rather than leaving it alone", () => {
    const { settings, changed } = mergeSettingsJson(
      { permissions: { deny: ["Bash(rm:*)"], allow: ["Bash(ls:*)"] } },
      PLUGIN,
    );

    expect(changed).toBe(true);
    const permissions = settings["permissions"] as { deny: string[]; allow: string[] };
    // The operator's own rule survives...
    expect(permissions.deny).toContain("Bash(rm:*)");
    // ...and so does everything they allowed: this merge only ever tightens.
    expect(permissions.allow).toStrictEqual(["Bash(ls:*)"]);
    for (const rule of APPROVAL_DENY_RULES) expect(permissions.deny).toContain(rule);
  });

  it("does not duplicate a rule the operator already wrote", () => {
    const first = APPROVAL_DENY_RULES[0]!;
    const { settings } = mergeSettingsJson({ permissions: { deny: [first] } }, PLUGIN);

    const deny = (settings["permissions"] as { deny: string[] }).deny;
    expect(deny.filter((rule) => rule === first)).toHaveLength(1);
  });

  /**
   * Idempotence, asserted through `changed` rather than through the value: an
   * installer that reported a change on every run would make its own drift
   * detector cry wolf, and this file already pays that cost for the add-only
   * keys.
   */
  it("reports NO change when every rule is already present", () => {
    const seeded = mergeSettingsJson({}, PLUGIN).settings;

    expect(mergeSettingsJson(seeded, PLUGIN).changed).toBe(false);
  });

  /**
   * The rules must name the real command surface. Derived from `parse-command.ts`'s
   * own verbs rather than retyped: `crabgic approve`, `design approve`,
   * `learn approve`, `trust approve` and `trust review` are the five gates the
   * operating protocol lists as human acts.
   */
  it("covers every approval verb the CLI actually parses", () => {
    for (const verb of [
      "approve",
      "design approve",
      "learn approve",
      "trust approve",
      "trust review",
    ]) {
      expect(APPROVAL_DENY_RULES.some((rule) => rule.includes(verb))).toBe(true);
    }
  });

  /** The signing key is the other way to forge an approval: mint a token yourself. */
  it("denies reading the approval signing key", () => {
    expect(APPROVAL_DENY_RULES.some((rule) => rule.includes("approval-signing.key"))).toBe(true);
  });
});

/**
 * `.claude/settings.json` add-only merge — roadmap/10-plugin-and-
 * installer.md §In scope: "add-only keys — `attribution: {"commit": "",
 * "pr": ""}`, `sessionUrl: false` (§5.4), `enabledPlugins` — honoring
 * monotonicity (never loosen a security key already present in the target
 * repo)." The monotonicity rule is enforced the simplest possible way: any
 * key already present in `existing`, at the granularity named by roadmap/10
 * itself, is NEVER touched — only a wholly-absent key is ever added. This
 * trivially satisfies "never loosen a security key already present" because
 * this code never writes to one.
 */
import { STATUSLINE_SETTINGS_ENTRY } from "./statusline-writer.js";
import { OUTPUT_STYLE_SETTINGS_VALUE } from "./output-style-writer.js";

/**
 * The permission DENY rules that make an approval gate a human act again.
 *
 * ⚠️ WHY THESE EXIST, MEASURED 2026-08-18. The operating protocol calls the
 * approval gates "a human act by design and which you can never satisfy
 * yourself". Against a manager session that was not true:
 * `../approval/prompt.ts`'s `readConfirmation` reads one line from `io.input`
 * and checks no TTY — its own doc records that "'yes' followed by end-of-input
 * confirms" — and this project shipped no `permissions` block at all. Piping
 * `yes` into the CLI satisfied every gate.
 *
 * A permission deny is enforced by the ENGINE rather than by the agent's
 * cooperation, so it is the one control here an instruction cannot talk its way
 * past. With the CLI path closed, the gate is reached the way owner ruling
 * 2026-08-18 intends: asked in Claude Code, answered by a person, recorded by
 * the harness.
 *
 * ⚠️ AN HONEST BOUND, and it belongs here rather than in a summary. These match
 * COMMAND PREFIXES. They do not stop `npx crabgic …`, a direct `node …/bin.js`,
 * or any other spelling of the same program, and they do nothing about a
 * process that writes the state files directly. This is defence in depth: it
 * removes the accidental path and raises the cost of the deliberate one. It is
 * not a boundary, and `docs/deploy-posture.md` must not describe it as one.
 *
 * The five commands are the gates the protocol itself lists, spelled as
 * `../argv/parse-command.ts` parses them. The sixth rule covers the other way
 * to forge an approval — reading the signing key and minting a token.
 */
export const APPROVAL_DENY_RULES: readonly string[] = Object.freeze([
  "Bash(crabgic approve:*)",
  "Bash(crabgic design approve:*)",
  "Bash(crabgic learn approve:*)",
  "Bash(crabgic trust approve:*)",
  "Bash(crabgic trust review:*)",
  "Read(**/approval-signing.key)",
]);

export interface SettingsMergeResult {
  readonly settings: Record<string, unknown>;
  readonly changed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merges this plugin's add-only default keys into `existing` (target project's `.claude/settings.json`, parsed; `{}` for a brand-new file). `pluginName` is the `enabledPlugins` key this installer adds — never touched again once present, regardless of its value (even `false`/disabled — that is the user's own explicit choice, and monotonicity forbids re-enabling it). */
export function mergeSettingsJson(
  existing: Record<string, unknown>,
  pluginName: string,
): SettingsMergeResult {
  const merged: Record<string, unknown> = { ...existing };
  let changed = false;

  /**
   * ⚠️ THE ONE KEY THIS MERGE TIGHTENS RATHER THAN MERELY ADDS.
   *
   * Every other key here is add-only: present means untouched, which trivially
   * satisfies "never loosen a security key already present". That rule would
   * have left the approval hole open forever in any project whose
   * `permissions` block already existed for an unrelated reason.
   *
   * Monotonicity forbids LOOSENING. Adding a deny is the opposite operation, so
   * the rules are UNIONED in: the operator's own deny entries survive, their
   * `allow` list is never read or written, and nothing is ever removed. A rule
   * already present is not duplicated, so a second run reports no change.
   */
  const permissions = isPlainObject(merged.permissions) ? { ...merged.permissions } : {};
  const existingDeny = Array.isArray(permissions.deny)
    ? permissions.deny.filter((rule): rule is string => typeof rule === "string")
    : [];
  const missingDeny = APPROVAL_DENY_RULES.filter((rule) => !existingDeny.includes(rule));
  if (missingDeny.length > 0) {
    permissions.deny = [...existingDeny, ...missingDeny];
    merged.permissions = permissions;
    changed = true;
  }

  if (!("attribution" in merged)) {
    merged.attribution = { commit: "", pr: "" };
    changed = true;
  }
  if (!("sessionUrl" in merged)) {
    merged.sessionUrl = false;
    changed = true;
  }

  // The status line (`./statusline-writer.ts`). Add-only on exactly the same
  // terms as the keys above: a user who already configured a `statusLine` —
  // their own script, or a disabled/blank one — keeps it untouched, because
  // silently replacing someone's status line is the display equivalent of
  // loosening a key they set deliberately.
  if (!("statusLine" in merged)) {
    merged.statusLine = { ...STATUSLINE_SETTINGS_ENTRY };
    changed = true;
  }

  // The output style (`./output-style-writer.ts`). Add-only on exactly the same
  // terms, and for a stronger version of the same reason: this key changes the
  // REGISTER of every session in the project, so an operator who already chose
  // a style — or deliberately chose none — keeps their choice. Replacing it
  // silently would be the communication equivalent of loosening a setting they
  // set on purpose.
  //
  // The mechanism is not probe-verified (engine-baseline §23.4). Add-only means
  // the worst case is an inert key, never a clobbered one.
  if (!("outputStyle" in merged)) {
    merged.outputStyle = OUTPUT_STYLE_SETTINGS_VALUE;
    changed = true;
  }

  // ADVERSARIAL-REVIEW FIX (2026-07-24, CONFIRMED monotonicity violation):
  // this used to be guarded by `isPlainObject(merged.enabledPlugins)` — a
  // present-but-wrong-typed value (e.g. `enabledPlugins: "foo"`) was
  // treated as ABSENT and silently overwritten with
  // `{[pluginName]: true}`, destroying the user's own value. Guarded by
  // presence now (`"enabledPlugins" in merged`), matching `attribution`/
  // `sessionUrl` above: ANY value already present, of ANY type, is never
  // touched — add-only means we don't even attempt to merge into
  // something we can't safely interpret as a plugin map.
  if (!("enabledPlugins" in merged)) {
    merged.enabledPlugins = { [pluginName]: true };
    changed = true;
  } else if (isPlainObject(merged.enabledPlugins) && !(pluginName in merged.enabledPlugins)) {
    merged.enabledPlugins = { ...merged.enabledPlugins, [pluginName]: true };
    changed = true;
  }

  return { settings: merged, changed };
}

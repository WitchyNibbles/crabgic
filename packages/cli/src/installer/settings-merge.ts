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

  if (!("attribution" in merged)) {
    merged.attribution = { commit: "", pr: "" };
    changed = true;
  }
  if (!("sessionUrl" in merged)) {
    merged.sessionUrl = false;
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

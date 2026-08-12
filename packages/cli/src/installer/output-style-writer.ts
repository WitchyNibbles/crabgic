/**
 * `.claude/output-styles/crabgic.md` writer — the prevention layer's delivery.
 *
 * Shaped exactly like `./statusline-writer.ts`, and for the same measured
 * reason. `docs/engine-baseline.md` §17 established that `statusLine` exists
 * only in `settings.json` and has no plugin-manifest key; §23 establishes the
 * same for output styles — a plugin carrying one inventories no such category
 * and adds `~0 tok`. So both are wholly-owned project artifacts (`kind: "full"`)
 * written by the installer, each paired with an ADD-ONLY `settings.json` key.
 *
 * Generated from `@crabgic/plugin`'s `buildOutputStyle()` rather than copied
 * from a file on disk — the same arrangement `./claude-md.ts` uses for the
 * manager protocol block. The limits it quotes therefore come from
 * `HUMAN_REPORT_LIMITS` at build time and cannot drift from the policy.
 *
 * The mechanism this delivers IS probe-verified — §23.4, engine 2.1.224: a
 * project-level style reaches the model, measured against a control arm.
 */
import { join } from "node:path";
import { buildOutputStyle, OUTPUT_STYLE_NAME } from "@crabgic/plugin";

/** Where the style lands in the target project. */
export const OUTPUT_STYLE_REL_PATH = join(".claude", "output-styles", "crabgic.md");

/**
 * The `settings.json` value that ACTIVATES the style.
 *
 * Separate from the file on purpose. Writing the file is inert; setting this
 * key changes the register of every session in the project. The merge treats it
 * as add-only, so an operator who already chose a style keeps it — silently
 * replacing someone's chosen output style is the register equivalent of
 * loosening a setting they made deliberately, which is the rule
 * `./settings-merge.ts` already applies to `statusLine`.
 */
export const OUTPUT_STYLE_SETTINGS_VALUE = OUTPUT_STYLE_NAME;

export interface OutputStyleFileToInstall {
  readonly relPath: string;
  readonly content: string;
}

/** The style file, ready to be written verbatim to `OUTPUT_STYLE_REL_PATH`. */
export function loadOutputStyleFileToInstall(): OutputStyleFileToInstall {
  return { relPath: OUTPUT_STYLE_REL_PATH, content: buildOutputStyle() };
}

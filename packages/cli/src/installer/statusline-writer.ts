/**
 * `.claude/crabgic-statusline.mjs` writer — the status-line counterpart to
 * `./agents-writer.ts`, and wholly-owned (`kind: "full"`) for the same
 * reason: the installer is its sole author in the target project.
 *
 * Why a copied project artifact rather than something the plugin registers
 * for itself: `statusLine` exists only in `settings.json`. Engine 2.1.220's
 * plugin manifest schema has no `statusLine` key at all, and a `settings.
 * json` command referencing `${CLAUDE_PLUGIN_ROOT}` is rejected outright
 * ("this variable is only available in hooks defined in a plugin's
 * hooks/hooks.json file"). Both facts are recorded in
 * `docs/engine-baseline.md` §17.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Where the script lands in the target project. */
export const STATUSLINE_REL_PATH = join(".claude", "crabgic-statusline.mjs");

/**
 * The `settings.json` value the installer adds.
 *
 * `$CLAUDE_PROJECT_DIR` (exported by the engine into the status-line
 * command's environment, engine-baseline §17) keeps this string free of
 * machine-specific absolute paths, because `.claude/settings.json` is
 * routinely committed and shared across a team. The `:-.` default degrades
 * to the session cwd — which is the project directory in the ordinary case —
 * so the line still renders if that variable ever goes away. POSIX shell
 * form is deliberate: this project supports Linux x86-64/ARM64 and WSL2
 * only (`docs/compatibility-matrix.md`), so there is no PowerShell target to
 * accommodate.
 */
export const STATUSLINE_SETTINGS_ENTRY = {
  type: "command",
  command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/crabgic-statusline.mjs"',
  padding: 0,
  // Event-driven refreshes go quiet while a manager session waits on
  // background workers — crabgic's steady state — and the branch/dirty
  // segment reads live git state that those workers change underneath it.
  refreshInterval: 30,
} as const;

export interface StatusLineFileToInstall {
  readonly relPath: string;
  readonly content: string;
}

/** Reads the plugin's own status-line script, ready to be written verbatim to `STATUSLINE_REL_PATH` in the target project. Throws if the plugin source directory does not carry one, rather than installing a `settings.json` entry pointing at a file that is not there. */
export async function loadStatusLineFileToInstall(
  pluginSourceDir: string,
): Promise<StatusLineFileToInstall> {
  const content = await readFile(
    join(pluginSourceDir, "statusline", "crabgic-statusline.mjs"),
    "utf8",
  );
  return { relPath: STATUSLINE_REL_PATH, content };
}

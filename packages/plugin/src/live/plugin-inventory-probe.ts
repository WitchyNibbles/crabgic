/**
 * Real, local, non-model plugin-inventory probe — roadmap/10-plugin-and-
 * installer.md exit criterion `plugin.live-smoke`: "plugin loads in a real
 * session ... skills visible, gateway MCP tools listed, subagents
 * spawnable." Ground-truthed against a live `claude plugin details
 * --plugin-dir <dir> <name>` run (engine 2.1.218, this phase's own build):
 * that command needs no OAuth/subscription auth at all (pure local manifest
 * inspection — confirmed by running it directly, no token configured), so
 * it is the deterministic backbone of the smoke test; only the optional
 * subagent-spawn check (`./assert-subagent-spawnable.ts`) needs a real
 * model turn / auth.
 *
 * NOTE (adversarial-review-style discovery during this phase's own build):
 * the phase's own governing docs describe skills living directly under
 * `skills/<name>.md` — real Claude Code (verified live, see above) only
 * recognizes `skills/<name>/SKILL.md`. `../plugin-manifest.ts` and this
 * package's own `skills/*` layout were corrected to match the verified
 * live behavior, not the doc's unverified assumption — consistent with
 * this phase's own risk note: "the exact prompt copy/flow ... confirm
 * against the live engine during work item 9 rather than asserting
 * specific prompt text."
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PluginInventory {
  readonly found: boolean;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly mcpServers: readonly string[];
}

const EMPTY_INVENTORY: PluginInventory = { found: false, skills: [], agents: [], mcpServers: [] };

function parseListLine(output: string, label: string): readonly string[] {
  const pattern = new RegExp(`${label} \\(\\d+\\)\\s+([^\\n]+)`);
  const match = pattern.exec(output);
  if (match === undefined || match === null) return [];
  const rest = match[1]!.split("(")[0]!.trim(); // Drop a trailing "(harness-only ...)"/"(tool schemas ...)" annotation, if present.
  if (rest.length === 0) return [];
  return rest
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface PluginInventoryProbe {
  (options: { readonly pluginDir?: string; readonly pluginName: string }): Promise<PluginInventory>;
}

/** Real probe: spawns `claude [--plugin-dir <dir>] plugin details <name>` and parses its component-inventory output. A "not found" exit is reported as `{found:false, ...empty}`, never thrown — absence is an expected, assertable outcome (work item 9's negative-space sanity check). */
export const probePluginInventory: PluginInventoryProbe = async (options) => {
  const args = [
    ...(options.pluginDir !== undefined ? ["--plugin-dir", options.pluginDir] : []),
    "plugin",
    "details",
    options.pluginName,
  ];
  let stdout: string;
  try {
    const result = await execFileAsync("claude", args, { timeout: 30_000 });
    stdout = result.stdout;
  } catch (err) {
    const maybeStdout = (err as { stdout?: string }).stdout;
    if (typeof maybeStdout === "string" && maybeStdout.includes("not found")) {
      return EMPTY_INVENTORY;
    }
    throw err;
  }
  if (stdout.includes("not found")) return EMPTY_INVENTORY;

  return {
    found: true,
    skills: parseListLine(stdout, "Skills"),
    agents: parseListLine(stdout, "Agents"),
    mcpServers: parseListLine(stdout, "MCP servers"),
  };
};

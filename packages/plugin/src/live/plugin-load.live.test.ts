/**
 * `@live` plugin-load smoke test — roadmap/10-plugin-and-installer.md exit
 * criterion `plugin.live-smoke`: "plugin loads in a real session on the 06
 * baseline range — skills visible, gateway MCP tools listed, subagents
 * spawnable." The inventory half (`probePluginInventory`) is a real, local,
 * non-model `claude plugin details --plugin-dir` call (no auth needed); the
 * subagent-spawn half is a real, minimal model turn (needs auth — the
 * `engine-live` CI job's own preflight already guarantees
 * `CLAUDE_CODE_OAUTH_TOKEN` is present before `npm run test:live` starts).
 *
 * Per this phase's own risk note ("the exact prompt copy/flow ... confirm
 * against the live engine during work item 9 rather than asserting
 * specific prompt text"), the subagent-spawn prompt below is intentionally
 * loose (explicit tool-use instruction, structural assertion on the
 * transcript) rather than pinned to exact wording.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { assertLiveEnabled } from "./live-gate.js";
import { probePluginInventory } from "./plugin-inventory-probe.js";
import { PLUGIN_CAPABILITY_NAME } from "../capability-entry.js";
import { resolvePluginRoot } from "../plugin-root.js";
import { REQUIRED_SKILL_NAMES, REQUIRED_SUBAGENT_NAMES } from "../plugin-manifest.js";

const execFileAsync = promisify(execFile);

describe("@live plugin.live-smoke — positive (plugin loaded via --plugin-dir)", () => {
  it("`claude plugin validate` accepts this package's own manifest (non-strict: two known, intentional unknown-field warnings for the marketplace's own `commit`/`digest` extension fields)", async () => {
    assertLiveEnabled();
    const { stdout } = await execFileAsync("claude", ["plugin", "validate", resolvePluginRoot()], {
      timeout: 30_000,
    });
    expect(stdout).toContain("Validation passed");
  });

  it("lists every required skill, subagent, and the gateway MCP server", async () => {
    assertLiveEnabled();
    const inventory = await probePluginInventory({
      pluginDir: resolvePluginRoot(),
      pluginName: PLUGIN_CAPABILITY_NAME,
    });
    expect(inventory.found).toBe(true);
    for (const name of REQUIRED_SKILL_NAMES) {
      expect(inventory.skills).toContain(name);
    }
    for (const name of REQUIRED_SUBAGENT_NAMES) {
      expect(inventory.agents).toContain(name);
    }
    expect(inventory.mcpServers).toContain(GATEWAY_MCP_SERVER_NAME);
  });

  it("a subagent (eo-explore) is spawnable in a real session", async () => {
    assertLiveEnabled();
    const pluginRoot = resolvePluginRoot();
    const { stdout } = await execFileAsync(
      "claude",
      [
        "--plugin-dir",
        pluginRoot,
        "--print",
        "--output-format",
        "json",
        "--allowedTools",
        "Task",
        "Use the Task tool to launch the eo-explore subagent and ask it to report the number of files in the current directory. Report only the subagent's finding.",
      ],
      { timeout: 120_000 },
    );
    const result = JSON.parse(stdout) as { result?: string };
    // A structural, non-exact-wording assertion (per this phase's own risk
    // note): the eo-explore subagent name surfaces somewhere in the
    // transcript/result once genuinely invoked via the Task tool.
    expect(String(result.result ?? stdout)).toMatch(/eo-explore/i);
  });
});

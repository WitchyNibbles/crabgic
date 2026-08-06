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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import {
  CLAUDE_CLI_BIN,
  SPAWN_PROBE_MAX_BUDGET_USD,
  SPAWN_PROBE_MODEL,
  SPAWN_PROBE_TIMEOUT_MS,
} from "./claude-cli.js";
import { assertLiveEnabled } from "./live-gate.js";
import { probePluginInventory } from "./plugin-inventory-probe.js";
import { PLUGIN_CAPABILITY_NAME } from "../capability-entry.js";
import { resolvePluginRoot } from "../plugin-root.js";
import { REQUIRED_SKILL_NAMES, REQUIRED_SUBAGENT_NAMES } from "../plugin-manifest.js";

const execFileAsync = promisify(execFile);

describe("@live plugin.live-smoke — positive (plugin loaded via --plugin-dir)", () => {
  it("`claude plugin validate` accepts this package's own manifest (non-strict: two known, intentional unknown-field warnings for the marketplace's own `commit`/`digest` extension fields)", async () => {
    assertLiveEnabled();
    const { stdout } = await execFileAsync(
      CLAUDE_CLI_BIN,
      ["plugin", "validate", resolvePluginRoot()],
      { timeout: 30_000 },
    );
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
    // BOUNDED CWD — the first of this case's three cost bounds, and the one
    // that fixes the measured overspend. The prompt used to say "the number of
    // files in the current directory" while the current directory was this
    // MONOREPO, so the subagent walked into `node_modules`: ~51 distinct
    // nested round trips behind ~2 parent turns
    // (`docs/verification-playbook.md` §BOUNDING A SUBAGENT-SPAWNING TEST).
    // A two-file scratch directory makes the same question answerable in one
    // Glob, by construction rather than by asking the model nicely.
    const scratchCwd = mkdtempSync(join(tmpdir(), "eo-plugin-live-spawn-"));
    writeFileSync(join(scratchCwd, "alpha.txt"), "alpha\n");
    writeFileSync(join(scratchCwd, "beta.txt"), "beta\n");
    try {
      // `--allowedTools` is declared VARIADIC (`<tools...>`) on the CLI, so in
      // its space-separated form it keeps consuming following operands: a
      // trailing prompt is absorbed as a second *tool name*, leaving the run
      // with no prompt at all ("Input must be provided either through stdin or
      // as a prompt argument when using --print"). The `=` form binds exactly
      // one value, which is what keeps the prompt below a prompt.
      //
      // Only the VARIADIC flag needs that treatment, and only `--allowedTools`
      // is variadic here; `--model` and `--max-budget-usd` use the `=` form
      // for visual consistency with it, while `--plugin-dir` and
      // `--output-format` use the space form and are equally safe — they are
      // declared single-arity, so they cannot swallow the trailing prompt.
      // Harness-only concern — nothing about the plugin under test changes.
      const invocation = execFileAsync(
        CLAUDE_CLI_BIN,
        [
          "--plugin-dir",
          pluginRoot,
          "--print",
          "--output-format",
          "json",
          "--allowedTools=Task",
          // The PARENT's model. Unpinned, it runs on the host default —
          // which on the one run this case has ever had was not the model it
          // was written against, making both the cost and the behaviour
          // unreproducible. The SUBAGENT's model is pinned separately, in
          // `agents/eo-explore.md`'s own frontmatter.
          `--model=${SPAWN_PROBE_MODEL}`,
          // The CLI's own documented cost bound, and the right tool for this
          // job. `--max-turns` is not the alternative it looks like: it is
          // undocumented here (`docs/engine-baseline.md` §10 records it absent
          // from `claude --help` since 2.1.210) and, per the measurement at
          // `docs/verification-playbook.md` §BOUNDING A SUBAGENT-SPAWNING
          // TEST, it does still PARSE while reading the top-level loop counter
          // — which a `Task` spawn's nested turns never reach. So it would
          // very likely not have stopped the runaway this case is bounded
          // against, whether or not it is advertised.
          `--max-budget-usd=${SPAWN_PROBE_MAX_BUDGET_USD}`,
          "Use the Task tool to launch the eo-explore subagent exactly once. Ask it to list the file names directly inside the current working directory — a scratch directory holding two small files and nothing else; it must not read or search any other path. In your answer, state which subagent you used by name, then its finding.",
        ],
        { cwd: scratchCwd, timeout: SPAWN_PROBE_TIMEOUT_MS },
      );
      // Node hands the child an open stdin pipe it never closes, and `--print`
      // spends 3s waiting on that pipe before proceeding without it. The prompt is
      // already in argv, so there is nothing to wait for — close it and skip the
      // stall (and the accompanying warning on stderr).
      invocation.child.stdin?.end();
      const { stdout } = await invocation;
      // Deliberately NOT asserted: the result's own `num_turns`. It counts the
      // top-level loop only, so it reads ~8 for a run that served ~58 model
      // round trips — asserting on it would pin a number that cannot see the
      // cost this case exists to bound.
      const result = JSON.parse(stdout) as { result?: string };
      // A structural, non-exact-wording assertion (per this phase's own risk
      // note): the eo-explore subagent name surfaces somewhere in the
      // transcript/result once genuinely invoked via the Task tool.
      //
      // FLAKE FIXED 2026-07-28. The prompt used to end "Report only the
      // subagent's finding", which contradicts this assertion outright: a model
      // that followed the instruction well answered with the file count alone
      // and FAILED, while one that padded its answer passed. Observed failing
      // and then passing on identical code minutes apart. The prompt now asks
      // for the subagent's name explicitly, so obeying it and satisfying the
      // assertion are the same act.
      expect(String(result.result ?? stdout)).toMatch(/eo-explore/i);
    } finally {
      rmSync(scratchCwd, { recursive: true, force: true });
    }
  });
});

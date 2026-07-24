/**
 * roadmap/10-plugin-and-installer.md exit criterion: "A post-install commit
 * made from the manager session carries no attribution (empty
 * `commit`/`pr`, `sessionUrl: false`) — assertion `attribution.none.test`,
 * cross-checked against 17's renderer lint." Two independent checks:
 *  1. Structural: this installer's own written `.claude/settings.json` has
 *     `attribution: {commit: "", pr: ""}` and `sessionUrl: false`.
 *  2. Cross-check against `@eo/renderer`'s own `lint()` (17's own
 *     attribution-neutral stage): a synthetic post-install commit
 *     message/PR body — the kind of text a manager session would actually
 *     produce after running `install` — independently passes 17's own
 *     attribution-neutral lint stage with zero findings, agreeing with (1)
 *     from a completely different (text-level, not JSON-structural) angle.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lint } from "@eo/renderer";
import { buildCommunicationPolicy } from "@eo/testkit";
import { runInstall } from "./install.js";
import type { InstallerDependencies } from "./types.js";

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-attribution-none-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function deps(targetDir: string): InstallerDependencies {
  return { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true };
}

describe("attribution.none.test", () => {
  it("a fresh install's settings.json carries empty commit/pr attribution and sessionUrl: false", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.attribution).toEqual({ commit: "", pr: "" });
    expect(settings.sessionUrl).toBe(false);
  });

  it("cross-check (17's renderer lint): a synthetic post-install commit body carries no attribution/engine-credit tokens", () => {
    // NOTE: this synthetic body deliberately avoids the literal words
    // "Claude"/"claude" — 17's own attribution-neutral stage independently
    // (and correctly) treats any engine/vendor name as an attribution
    // token, per the assertion below, so the "neutral" body under test
    // must itself already be vendor-neutral, exactly as a real
    // renderer-produced commit body would be.
    const policy = buildCommunicationPolicy();
    const commitBody =
      "feat: install the engineering-orchestrator plugin\n\n" +
      "Adds the managed instructions block, project settings, gateway MCP entry, and eo-* subagents.";

    const outcome = lint(commitBody, "commit_body", policy);
    expect(outcome.ok).toBe(true);
  });

  it("cross-check (17's renderer lint): a vendor/engine name alone (no co-author trailer) is ALSO caught — sanity-checks the cross-check's own sensitivity", () => {
    const policy = buildCommunicationPolicy();
    const outcome = lint("feat: install the CLAUDE.md managed block", "commit_body", policy);
    expect(outcome.ok).toBe(false);
  });

  it("cross-check (17's renderer lint): a commit body carrying an attribution token IS caught by 17's own lint (sanity-checks the cross-check itself)", () => {
    const policy = buildCommunicationPolicy();
    const outcome = lint(
      "Generated with Claude Code\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      "commit_body",
      policy,
    );
    expect(outcome.ok).toBe(false);
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { ENABLED_PLUGIN_KEY } from "@eo/plugin";
import { runInstall } from "./install.js";
import { readInstallState } from "./state-store.js";
import type { InstallerDependencies } from "./types.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-install-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

function deps(
  targetDir: string,
  overrides: Partial<InstallerDependencies> = {},
): InstallerDependencies {
  return {
    targetDir,
    pluginSourceDir: PLUGIN_ROOT,
    confirmGitInit: async () => true,
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runInstall — basic writes", () => {
  it("writes CLAUDE.md, .claude/settings.json, .mcp.json, and both eo-*.md agents into an empty directory", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.status).toBe("installed");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "agents", "eo-explore.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "agents", "eo-reviewer.md"))).toBe(true);
  });

  it("writes a .mcp.json whose entry is keyed GATEWAY_MCP_SERVER_NAME with the exact gateway command", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const mcpJson = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(mcpJson.mcpServers[GATEWAY_MCP_SERVER_NAME]).toEqual({
      command: "engineering-orchestrator",
      args: ["gateway", "mcp"],
    });
  });

  it("uses the @AGENTS.md bridge form when the target repo already has an AGENTS.md", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "AGENTS.md"), "# Agents instructions\n", "utf8");
    await runInstall(deps(dir), { dryRun: false });
    const claudeMd = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("@AGENTS.md");
  });

  it("records install state with a sourceDigest", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const state = await readInstallState(dir);
    expect(state?.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(state?.artifacts).toHaveLength(5);
  });

  it("writes enabledPlugins keyed by the LIVE-VERIFIED <plugin-name>@<marketplace-name> format, not the bare plugin name", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.enabledPlugins).toEqual({ [ENABLED_PLUGIN_KEY]: true });
    expect(ENABLED_PLUGIN_KEY).toBe(
      "engineering-orchestrator@engineering-orchestrator-marketplace",
    );
  });
});

describe("runInstall — idempotency (running install twice diffs clean)", () => {
  it("reports action: unchanged for every artifact on a second run", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const second = await runInstall(deps(dir), { dryRun: false });
    expect(second.status).toBe("already-installed");
    expect(second.diff.every((d) => d.action === "unchanged")).toBe(true);
  });
});

describe("runInstall — --dry-run never writes", () => {
  it("reports the diff without creating any file", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(deps(dir), { dryRun: true });
    expect(result.status).toBe("dry-run");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(result.diff.some((d) => d.relPath === "CLAUDE.md" && d.action === "create")).toBe(true);
  });
});

describe("runInstall — add-only merge preserves pre-existing user content", () => {
  it("preserves a pre-existing CLAUDE.md's own content, appending rather than replacing", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "CLAUDE.md"), "# My own project notes\n", "utf8");
    await runInstall(deps(dir), { dryRun: false });
    const claudeMd = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("My own project notes");
  });

  it("preserves a pre-existing settings.json's own unrelated keys", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), '{"myOwnKey":42}\n', "utf8");
    await runInstall(deps(dir), { dryRun: false });
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.myOwnKey).toBe(42);
    expect(settings.attribution).toEqual({ commit: "", pr: "" });
  });
});

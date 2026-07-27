/**
 * `.claude/crabgic-statusline.mjs` writer.
 *
 * The status line cannot ship the way the rest of the plugin's behaviour
 * does: `statusLine` is a `settings.json`-only key with no `plugin.json`
 * equivalent, and engine 2.1.220 *hard-errors* on a `settings.json` command
 * that references `${CLAUDE_PLUGIN_ROOT}` ("this variable is only available
 * in hooks defined in a plugin's hooks/hooks.json file") — see
 * `docs/engine-baseline.md` §17. So the installer copies the script into the
 * target project as a wholly-owned artifact, exactly like `.claude/agents/
 * eo-*.md`, and points `settings.json` at it via `$CLAUDE_PROJECT_DIR`.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePluginRoot } from "@crabgic/plugin";
import {
  STATUSLINE_REL_PATH,
  STATUSLINE_SETTINGS_ENTRY,
  loadStatusLineFileToInstall,
} from "./statusline-writer.js";

let targetDir: string;

beforeEach(async () => {
  targetDir = await mkdtemp(join(tmpdir(), "crabgic-statusline-"));
});

afterEach(async () => {
  await rm(targetDir, { recursive: true, force: true });
});

describe("loadStatusLineFileToInstall", () => {
  it("installs to a project-owned path under .claude/", () => {
    expect(STATUSLINE_REL_PATH).toBe(join(".claude", "crabgic-statusline.mjs"));
  });

  it("copies the plugin's own script verbatim", async () => {
    const file = await loadStatusLineFileToInstall(resolvePluginRoot());
    const source = await readFile(
      join(resolvePluginRoot(), "statusline", "crabgic-statusline.mjs"),
      "utf8",
    );
    expect(file.relPath).toBe(STATUSLINE_REL_PATH);
    expect(file.content).toBe(source);
  });

  it("copies a script that is executable as-is (shebang preserved)", async () => {
    const file = await loadStatusLineFileToInstall(resolvePluginRoot());
    expect(file.content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("rejects a plugin source directory with no status line rather than installing an empty one", async () => {
    await expect(loadStatusLineFileToInstall(targetDir)).rejects.toThrow();
  });
});

describe("STATUSLINE_SETTINGS_ENTRY", () => {
  it("is a command-type status line, the only type the engine accepts", () => {
    expect(STATUSLINE_SETTINGS_ENTRY.type).toBe("command");
  });

  it("resolves the script through $CLAUDE_PROJECT_DIR so the setting stays machine-independent", () => {
    // An absolute path would be correct on the installing machine only, and
    // `.claude/settings.json` is routinely committed and shared.
    expect(STATUSLINE_SETTINGS_ENTRY.command).toContain("CLAUDE_PROJECT_DIR");
    expect(STATUSLINE_SETTINGS_ENTRY.command).not.toMatch(/^\/|[A-Za-z]:\\/);
  });

  it("falls back to the session cwd if the engine ever stops exporting that variable", () => {
    expect(STATUSLINE_SETTINGS_ENTRY.command).toContain(":-.");
  });

  it("never references ${CLAUDE_PLUGIN_ROOT}, which the engine rejects outside plugin hooks", () => {
    expect(STATUSLINE_SETTINGS_ENTRY.command).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("points at the same path the writer installs to", () => {
    expect(STATUSLINE_SETTINGS_ENTRY.command).toContain(".claude/crabgic-statusline.mjs");
  });

  it("sets a refresh interval, because an orchestrator's git state changes while the manager session is idle", () => {
    // Event-driven updates go quiet while a coordinator waits on background
    // workers — precisely crabgic's steady state — so the branch/dirty
    // segment would otherwise go stale. Minimum accepted by the engine is 1.
    expect(STATUSLINE_SETTINGS_ENTRY.refreshInterval).toBeGreaterThanOrEqual(1);
  });
});

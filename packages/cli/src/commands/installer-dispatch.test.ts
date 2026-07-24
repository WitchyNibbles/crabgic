/**
 * `dispatchCommand`'s conditional routing for `install`/`upgrade`/
 * `uninstall` (roadmap/10-plugin-and-installer.md) — when `deps.installer`
 * IS supplied, these three commands hit the real backend rather than
 * `NOT_IMPLEMENTED`. `./cli.commands.schema.test.ts`'s own suite (09,
 * unmodified by this phase) proves the OTHER half: without `deps.installer`
 * they still return the exact typed `NOT_IMPLEMENTED` shape.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK } from "../exit-codes.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-installer-dispatch-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function baseDeps(): Pick<CliDependencies, "connectClient" | "journal" | "projectHash"> {
  return {
    connectClient: () => {
      throw new Error("not needed for this test");
    },
    journal: {
      queryEntries: async function* () {
        /* no entries */
      },
      verifyJournal: async () => ({ ok: true, entries: 0 }) as never,
    },
    projectHash: "test-hash",
  };
}

describe("dispatchCommand — install/upgrade/uninstall, real backend when deps.installer is supplied", () => {
  it("install --json actually installs when deps.installer is present", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("installed");
  });

  it("upgrade --json runs the real upgrade backend when deps.installer is present", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: true }, deps);
    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("up-to-date");
  });

  it("uninstall --json runs the real uninstall backend when deps.installer is present", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand(
      { command: "uninstall", keepState: false, json: true },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);
    const parsed = JSON.parse(result.stdout!) as { status: string };
    expect(parsed.status).toBe("uninstalled");
  });

  it("install (non-json) renders a human-readable diff summary", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    const result = await dispatchCommand({ command: "install", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("install:");
    expect(result.stdout).toContain("CLAUDE.md");
  });

  it("upgrade (non-json) renders a human-readable diff summary, including an updated (~) entry", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(targetDir, "CLAUDE.md"), "drifted, forces an update line\n", "utf8");

    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("upgrade:");
    expect(result.stdout).toContain("~ CLAUDE.md");
  });

  it("upgrade (non-json) mentions recovery when a prior interrupted upgrade is reconciled", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const { readFile, writeFile } = await import("node:fs/promises");
    const { backupArtifact, writeUpgradeMarker } = await import("../installer/state-store.js");
    const original = await readFile(join(targetDir, "CLAUDE.md"), "utf8");
    const backupPath = await backupArtifact(targetDir, "CLAUDE.md", original);
    await writeUpgradeMarker(targetDir, [
      {
        relPath: "CLAUDE.md",
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        ...(backupPath ? { backupPath } : {}),
      },
    ]);
    await writeFile(join(targetDir, "CLAUDE.md"), "TORN", "utf8");

    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: false }, deps);
    expect(result.stdout).toContain("recovered a prior interrupted upgrade");
  });

  it("uninstall (non-json) renders a human-readable outcome summary", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand(
      { command: "uninstall", keepState: false, json: false },
      deps,
    );
    expect(result.stdout).toContain("uninstall:");
    expect(result.stdout).toContain("CLAUDE.md");
  });
});

describe("dispatchCommand — doctor registers roadmap/10's 3 checks only when deps.installer is present", () => {
  it("doctor --json reports 11 findings (09's 8 + this phase's 3) when deps.installer is supplied", async () => {
    const targetDir = await makeTmpDir();
    const deps: CliDependencies = {
      ...baseDeps(),
      installer: { targetDir, pluginSourceDir: PLUGIN_ROOT, confirmGitInit: async () => true },
    };
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout!) as { findings: readonly unknown[] };
    expect(parsed.findings).toHaveLength(11);
  });

  it("doctor --json still reports exactly 8 findings when deps.installer is absent (09's own baseline, unchanged)", async () => {
    const deps: CliDependencies = baseDeps() as CliDependencies;
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout!) as { findings: readonly unknown[] };
    expect(parsed.findings).toHaveLength(8);
  });
});

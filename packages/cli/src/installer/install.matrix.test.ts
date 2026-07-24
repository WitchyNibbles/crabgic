/**
 * roadmap/10-plugin-and-installer.md exit criterion, suite
 * `install.matrix.test`: "Installation matrix passes end-to-end: empty dir,
 * invalid `.git`, unborn HEAD, dirty repo, monorepo, config drift,
 * interrupted upgrade, rollback, uninstall preserving user edits."
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runInstall } from "./install.js";
import { runUpgrade, recoverInterruptedUpgrade } from "./upgrade.js";
import { runUninstall } from "./uninstall.js";
import { backupArtifact, writeUpgradeMarker, readUpgradeMarker } from "./state-store.js";
import type { InstallerDependencies } from "./types.js";

const execFileAsync = promisify(execFile);
const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-install-matrix-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

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

describe("install.matrix.test", () => {
  it("empty dir: no .git at all — installs after the confirmGitInit gate approves, and git init actually runs", async () => {
    const dir = await makeTmpDir();
    let asked = false;
    const result = await runInstall(
      deps(dir, {
        confirmGitInit: async () => {
          asked = true;
          return true;
        },
      }),
      { dryRun: false },
    );
    expect(asked).toBe(true);
    expect(result.repoState).toBe("not-a-repo");
    expect(result.gitInitPerformed).toBe(true);
    expect(result.status).toBe("installed");
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("empty dir: git init declined — no artifacts are written at all", async () => {
    const dir = await makeTmpDir();
    const result = await runInstall(deps(dir, { confirmGitInit: async () => false }), {
      dryRun: false,
    });
    expect(result.status).toBe("aborted-git-init-declined");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });

  it("invalid .git: a corrupt .git directory does not block file installation", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "HEAD"), "garbage, not a real git HEAD file");
    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.repoState).toBe("invalid-git");
    expect(result.status).toBe("installed");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
  });

  it("unborn HEAD: a freshly `git init`-ed repo with zero commits installs cleanly", async () => {
    const dir = await makeTmpDir();
    await execFileAsync("git", ["init"], { cwd: dir });
    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.repoState).toBe("unborn-head");
    expect(result.status).toBe("installed");
  });

  it("dirty repo: uncommitted working-tree changes do not block installation", async () => {
    const dir = await makeTmpDir();
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "t@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "T"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "a");
    await execFileAsync("git", ["add", "a.txt"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "modified, uncommitted");

    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.repoState).toBe("dirty");
    expect(result.status).toBe("installed");
  });

  it("monorepo: a nested package.json is detected and does not disrupt root-level installation", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, "packages", "sub"), { recursive: true });
    await writeFile(join(dir, "packages", "sub", "package.json"), "{}");

    const result = await runInstall(deps(dir), { dryRun: false });
    expect(result.monorepoDetected).toBe(true);
    expect(result.status).toBe("installed");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
  });

  it("config drift: an externally-mutated CLAUDE.md is picked back up cleanly by upgrade (a fresh, well-formed managed block is restored; add-only semantics never delete the drifted text itself)", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    // Overwriting the WHOLE file (losing the markers entirely) is the
    // sharpest drift case: the merge can no longer recognize its own prior
    // block at all, so add-only semantics correctly APPEND a fresh one
    // rather than silently discarding what might be meaningful user
    // content — this is the conservative, correct behavior, not a bug.
    await writeFile(join(dir, "CLAUDE.md"), "EXTERNALLY MUTATED, drifted content", "utf8");

    const upgradeResult = await runUpgrade(deps(dir), { dryRun: false });
    expect(upgradeResult.status).toBe("upgraded");
    const content = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(content).toContain("BEGIN ENGINEERING ORCHESTRATOR MANAGED BLOCK");
    expect(content).toContain("Engineering Orchestrator");
    // The state store is reconciled: a subsequent upgrade is up-to-date again.
    const second = await runUpgrade(deps(dir), { dryRun: false });
    expect(second.status).toBe("up-to-date");
  });

  it("interrupted upgrade: a kill-mid-write marker is fully recovered (no torn state) before the next operation proceeds", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const original = await readFile(join(dir, "CLAUDE.md"), "utf8");

    // Simulate: backup taken, marker written, write started, process killed
    // mid-write (torn/partial content on disk), marker left behind.
    const backupPath = await backupArtifact(dir, "CLAUDE.md", original);
    await writeUpgradeMarker(dir, [
      {
        relPath: "CLAUDE.md",
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        ...(backupPath ? { backupPath } : {}),
      },
    ]);
    await writeFile(join(dir, "CLAUDE.md"), "TORN, PARTIAL", "utf8");

    const recovery = await recoverInterruptedUpgrade(dir);
    expect(recovery.recovered).toBe(true);
    expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe(original);
    expect(await readUpgradeMarker(dir)).toBeUndefined();
  });

  it("rollback: runUpgrade itself recovers a lingering interrupted-upgrade marker before proceeding, restoring pre-upgrade content", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    const original = await readFile(join(dir, "CLAUDE.md"), "utf8");
    const backupPath = await backupArtifact(dir, "CLAUDE.md", original);
    await writeUpgradeMarker(dir, [
      {
        relPath: "CLAUDE.md",
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        ...(backupPath ? { backupPath } : {}),
      },
    ]);
    await writeFile(join(dir, "CLAUDE.md"), "TORN, PARTIAL", "utf8");

    const result = await runUpgrade(deps(dir), { dryRun: false });
    expect(result.recoveredFromInterruptedUpgrade).toBe(true);
  });

  it("uninstall preserving user edits: a user-edited agent file survives uninstall untouched, unedited artifacts are removed", async () => {
    const dir = await makeTmpDir();
    await runInstall(deps(dir), { dryRun: false });
    await writeFile(
      join(dir, ".claude", "agents", "eo-explore.md"),
      "USER'S OWN EDIT, must survive",
      "utf8",
    );

    const result = await runUninstall(dir, { keepState: false });
    const explore = result.outcomes.find((o) => o.relPath.endsWith("eo-explore.md"));
    expect(explore?.action).toBe("preserved-drifted");
    expect(await readFile(join(dir, ".claude", "agents", "eo-explore.md"), "utf8")).toBe(
      "USER'S OWN EDIT, must survive",
    );

    const reviewer = result.outcomes.find((o) => o.relPath.endsWith("eo-reviewer.md"));
    expect(reviewer?.action).toBe("removed");
    expect(existsSync(join(dir, ".claude", "agents", "eo-reviewer.md"))).toBe(false);
  });
});

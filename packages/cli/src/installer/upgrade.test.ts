import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInstall } from "./install.js";
import { runUpgrade, recoverInterruptedUpgrade } from "./upgrade.js";
import {
  readInstallState,
  readUpgradeMarker,
  writeUpgradeMarker,
  backupArtifact,
} from "./state-store.js";
import type { InstallerDependencies } from "./types.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-upgrade-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function deps(targetDir: string, pluginSourceDir: string): InstallerDependencies {
  return {
    targetDir,
    pluginSourceDir,
    confirmGitInit: async () => true,
    now: () => "2026-01-01T00:00:00.000Z",
  };
}

async function installFresh(targetDir: string, pluginSourceDir: string): Promise<void> {
  await runInstall(deps(targetDir, pluginSourceDir), { dryRun: false });
}

const PLUGIN_ROOT = new URL("../../../plugin", import.meta.url).pathname;

describe("runUpgrade", () => {
  it('reports "not-installed" when there is no prior install', async () => {
    const dir = await makeTmpDir();
    const result = await runUpgrade(deps(dir, PLUGIN_ROOT), { dryRun: false });
    expect(result.status).toBe("not-installed");
  });

  it('reports "up-to-date" with an empty diff when nothing has changed', async () => {
    const dir = await makeTmpDir();
    await installFresh(dir, PLUGIN_ROOT);
    const result = await runUpgrade(deps(dir, PLUGIN_ROOT), { dryRun: false });
    expect(result.status).toBe("up-to-date");
    expect(result.diff.every((d) => d.action === "unchanged")).toBe(true);
  });

  it("--dry-run reports the diff without writing anything", async () => {
    const dir = await makeTmpDir();
    await installFresh(dir, PLUGIN_ROOT);
    // Simulate drift so there is something to upgrade.
    await writeFile(join(dir, "CLAUDE.md"), "mutated externally\n", "utf8");
    const before = await readFile(join(dir, "CLAUDE.md"), "utf8");

    const result = await runUpgrade(deps(dir, PLUGIN_ROOT), { dryRun: true });
    expect(result.status).toBe("dry-run");
    const after = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(after).toBe(before);
  });

  it("a genuine upgrade backs up the previous content and updates the diff/state", async () => {
    const dir = await makeTmpDir();
    await installFresh(dir, PLUGIN_ROOT);
    await writeFile(join(dir, ".claude", "agents", "eo-explore.md"), "stale copy\n", "utf8");

    const result = await runUpgrade(deps(dir, PLUGIN_ROOT), { dryRun: false });
    expect(result.status).toBe("upgraded");
    const updatedEntry = result.diff.find((d) => d.relPath.endsWith("eo-explore.md"));
    expect(updatedEntry?.action).toBe("update");
    const content = await readFile(join(dir, ".claude", "agents", "eo-explore.md"), "utf8");
    expect(content).not.toBe("stale copy\n");

    const state = await readInstallState(dir);
    expect(state).toBeDefined();
    // No lingering marker after a clean upgrade.
    expect(await readUpgradeMarker(dir)).toBeUndefined();
  });
});

describe("recoverInterruptedUpgrade — work item 5's first-failing-test scenario, now fixed", () => {
  it("is a no-op when no marker exists", async () => {
    const dir = await makeTmpDir();
    const result = await recoverInterruptedUpgrade(dir);
    expect(result.recovered).toBe(false);
  });

  it("restores a file from its backup when a kill-mid-write marker is found (a process kill mid-write no longer leaves torn state)", async () => {
    const dir = await makeTmpDir();
    const relPath = "CLAUDE.md";
    const originalContent = "# original pre-upgrade content\n";
    await writeFile(join(dir, relPath), originalContent, "utf8");

    // Simulate exactly what runUpgrade does BEFORE writing: back up, write
    // the marker, then (unlike runUpgrade) stop here — as if the process
    // were killed mid-write, leaving the marker present and the file
    // possibly torn/partially written.
    const backupPath = await backupArtifact(dir, relPath, originalContent);
    await writeUpgradeMarker(dir, [
      {
        relPath,
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        ...(backupPath ? { backupPath } : {}),
      },
    ]);
    await writeFile(join(dir, relPath), "TORN PARTIAL WRITE", "utf8");

    const result = await recoverInterruptedUpgrade(dir);
    expect(result.recovered).toBe(true);
    expect(result.restoredPaths).toContain(relPath);
    expect(await readFile(join(dir, relPath), "utf8")).toBe(originalContent);
    expect(await readUpgradeMarker(dir)).toBeUndefined();
  });

  it("deletes an artifact that had no backup (did not exist before the interrupted attempt)", async () => {
    const dir = await makeTmpDir();
    const relPath = "brand-new-file.md";
    await writeUpgradeMarker(dir, [
      { relPath, kind: "full", installedChecksum: "", sourceVersion: "" },
    ]);
    await writeFile(join(dir, relPath), "TORN PARTIAL WRITE", "utf8");

    await recoverInterruptedUpgrade(dir);
    expect(existsSync(join(dir, relPath))).toBe(false);
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24, CONFIRMED edge): recovery is idempotent under a SECOND fault — a marker that survives a prior recovery attempt whose own backup was already consumed/deleted does not throw on a re-run", async () => {
    const dir = await makeTmpDir();
    const relPath = "CLAUDE.md";
    await writeFile(join(dir, relPath), "whatever survived the first partial recovery\n", "utf8");
    // The marker still lists a backupPath, but nothing exists there — as if
    // a PRIOR recoverInterruptedUpgrade run was itself killed after
    // deleteBackup but before removeUpgradeMarker.
    await writeUpgradeMarker(dir, [
      {
        relPath,
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        backupPath: join(dir, "eo-install-backups", "already-consumed.bak"),
      },
    ]);

    const result = await recoverInterruptedUpgrade(dir);
    expect(result.recovered).toBe(true);
    expect(result.restoredPaths).toContain(relPath);
    // The marker is still cleared, even though the backup was unusable.
    expect(await readUpgradeMarker(dir)).toBeUndefined();
  });

  it("runUpgrade itself recovers automatically from a lingering marker before doing anything else", async () => {
    const dir = await makeTmpDir();
    await installFresh(dir, PLUGIN_ROOT);
    const relPath = "CLAUDE.md";
    const original = await readFile(join(dir, relPath), "utf8");
    const backupPath = await backupArtifact(dir, relPath, original);
    await writeUpgradeMarker(dir, [
      {
        relPath,
        kind: "merged",
        installedChecksum: "",
        sourceVersion: "",
        ...(backupPath ? { backupPath } : {}),
      },
    ]);
    await writeFile(join(dir, relPath), "TORN", "utf8");

    const result = await runUpgrade(deps(dir, PLUGIN_ROOT), { dryRun: false });
    expect(result.recoveredFromInterruptedUpgrade).toBe(true);
  });
});

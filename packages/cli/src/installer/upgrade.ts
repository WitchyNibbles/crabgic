/**
 * `upgrade [--dry-run]` backend — roadmap/10-plugin-and-installer.md work
 * item 5: "diff renderer, backup/rollback, interrupted-upgrade recovery."
 * Work item 5's first failing test: "a process kill mid-write leaves torn
 * state under the stub (no recovery)" — this real implementation writes an
 * upgrade marker (with backups already taken) BEFORE touching any artifact,
 * and removes it only after every write in the batch succeeds; a future
 * `runUpgrade` call recovers from a lingering marker FIRST, before doing
 * anything else, which is also this module's own rollback mechanism (a
 * "rollback" IS a completed recovery from an interrupted/aborted attempt —
 * one mechanism serves both roles the roadmap lists together).
 */
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { computeContentDigest } from "@eo/plugin";
import { buildDesiredArtifacts, readTextIfExists } from "./install.js";
import { computeChecksum } from "./checksum.js";
import { renderUnifiedDiff } from "./diff-renderer.js";
import {
  atomicWriteFile,
  backupArtifact,
  deleteBackup,
  readInstallState,
  readUpgradeMarker,
  removeUpgradeMarker,
  restoreBackup,
  writeInstallState,
  writeUpgradeMarker,
  type ArtifactRecord,
  type InstallState,
} from "./state-store.js";
import type { InstallerDependencies } from "./types.js";

export interface UpgradeOptions {
  readonly dryRun: boolean;
}

export interface UpgradeDiffEntry {
  readonly relPath: string;
  readonly action: "create" | "update" | "unchanged";
  readonly unifiedDiff?: string;
}

export type UpgradeStatus = "upgraded" | "up-to-date" | "dry-run" | "not-installed";

export interface UpgradeResult {
  readonly status: UpgradeStatus;
  readonly diff: readonly UpgradeDiffEntry[];
  readonly recoveredFromInterruptedUpgrade: boolean;
}

export interface RecoveryResult {
  readonly recovered: boolean;
  readonly restoredPaths: readonly string[];
}

/** Recovers from a lingering upgrade marker left by a previous, interrupted (killed mid-write) `runUpgrade` call — restores every listed artifact from its backup (or deletes it, if it had none, meaning it did not exist before that attempt started), then clears the marker. A no-op (`recovered: false`) when no marker exists. */
export async function recoverInterruptedUpgrade(targetDir: string): Promise<RecoveryResult> {
  const marker = await readUpgradeMarker(targetDir);
  if (marker === undefined) return { recovered: false, restoredPaths: [] };

  const restoredPaths: string[] = [];
  for (const pending of marker.pending) {
    const targetPath = join(targetDir, pending.relPath);
    if (pending.backupPath !== undefined) {
      await restoreBackup(pending.backupPath, targetPath);
      await deleteBackup(pending.backupPath);
    } else {
      await rm(targetPath, { force: true });
    }
    restoredPaths.push(pending.relPath);
  }
  await removeUpgradeMarker(targetDir);
  return { recovered: true, restoredPaths };
}

/** Runs a full upgrade (or a `--dry-run` diff preview) against an already-installed `deps.targetDir`. Recovers any prior interrupted upgrade first. */
export async function runUpgrade(
  deps: InstallerDependencies,
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  const recovery = options.dryRun
    ? { recovered: false, restoredPaths: [] }
    : await recoverInterruptedUpgrade(deps.targetDir);

  const state = await readInstallState(deps.targetDir);
  if (state === undefined) {
    return {
      status: "not-installed",
      diff: [],
      recoveredFromInterruptedUpgrade: recovery.recovered,
    };
  }

  const desired = await buildDesiredArtifacts(deps, state);
  const diff: UpgradeDiffEntry[] = [];
  const toWrite: Array<{
    relPath: string;
    kind: "merged" | "full";
    content: string;
    targetPath: string;
    backupPath?: string;
  }> = [];

  for (const artifact of desired) {
    const targetPath = join(deps.targetDir, artifact.relPath);
    const currentOnDisk = await readTextIfExists(targetPath);
    const action: UpgradeDiffEntry["action"] =
      currentOnDisk === undefined
        ? "create"
        : currentOnDisk === artifact.content
          ? "unchanged"
          : "update";
    diff.push({
      relPath: artifact.relPath,
      action,
      ...(action === "update"
        ? { unifiedDiff: renderUnifiedDiff(currentOnDisk!, artifact.content) }
        : {}),
    });

    if (action !== "unchanged" && !options.dryRun) {
      const backupPath = await backupArtifact(deps.targetDir, artifact.relPath, currentOnDisk);
      toWrite.push({
        relPath: artifact.relPath,
        kind: artifact.kind,
        content: artifact.content,
        targetPath,
        ...(backupPath !== undefined ? { backupPath } : {}),
      });
    }
  }

  if (options.dryRun) {
    return { status: "dry-run", diff, recoveredFromInterruptedUpgrade: recovery.recovered };
  }
  if (toWrite.length === 0) {
    return { status: "up-to-date", diff, recoveredFromInterruptedUpgrade: recovery.recovered };
  }

  // Marker written BEFORE any real write — a kill between here and the
  // final `removeUpgradeMarker` below is exactly what `recoverInterruptedUpgrade` repairs on the next call.
  await writeUpgradeMarker(
    deps.targetDir,
    toWrite.map((w) => ({
      relPath: w.relPath,
      kind: w.kind,
      installedChecksum: "",
      sourceVersion: "",
      ...(w.backupPath !== undefined ? { backupPath: w.backupPath } : {}),
    })),
  );

  for (const w of toWrite) {
    await atomicWriteFile(w.targetPath, w.content);
  }

  await removeUpgradeMarker(deps.targetDir);
  for (const w of toWrite) {
    if (w.backupPath !== undefined) await deleteBackup(w.backupPath);
  }

  const artifacts: ArtifactRecord[] = desired.map((artifact) => ({
    relPath: artifact.relPath,
    kind: artifact.kind,
    installedChecksum: computeChecksum(artifact.content),
    sourceVersion: "0.0.0",
    ...(artifact.originalContent !== undefined
      ? { originalContent: artifact.originalContent }
      : {}),
  }));
  const newState: InstallState = {
    schemaVersion: 1,
    installedAt: (deps.now ?? (() => new Date().toISOString()))(),
    sourceVersion: "0.0.0",
    sourceDigest: computeContentDigest(deps.pluginSourceDir),
    artifacts,
  };
  await writeInstallState(deps.targetDir, newState);

  return { status: "upgraded", diff, recoveredFromInterruptedUpgrade: recovery.recovered };
}

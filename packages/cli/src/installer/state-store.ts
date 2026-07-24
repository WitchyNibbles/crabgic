/**
 * On-disk ownership/checksum/backup state store — roadmap/10-plugin-and-
 * installer.md §In scope, "Installer artifacts": "ownership + original/
 * installed checksums + source version + backups recorded in an on-disk
 * state store." Lives inside the target project itself (`.claude/`, not
 * XDG state) since it describes THAT project's own installed artifacts.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** How this installer relates to one tracked artifact: `"merged"` files (CLAUDE.md, settings.json, .mcp.json) are add-only merged into whatever pre-existed; `"full"` files (the copied `eo-*.md` subagents) are wholly owned by the installer. */
export type ArtifactKind = "merged" | "full";

export interface ArtifactRecord {
  readonly relPath: string;
  readonly kind: ArtifactKind;
  /** Checksum of the file's content immediately after this installer last wrote/merged it. */
  readonly installedChecksum: string;
  /** The plugin source version that produced `installedChecksum` (drives the CapabilityManifest-digest-freshness doctor check). */
  readonly sourceVersion: string;
  /** Set only while a backup exists for possible rollback (upgrade in progress, or kept after a completed upgrade for one generation). */
  readonly backupPath?: string;
  /**
   * For `kind: "merged"` artifacts only: the file's exact content BEFORE
   * this installer first touched it (`undefined` if the file did not exist
   * at all pre-install). `../uninstall.ts` restores exactly this snapshot
   * (or deletes the file, if `undefined`) for any artifact that is NOT
   * drifted — the simplest correct way to "remove only unchanged owned
   * content" without needing to reverse-engineer which JSON keys/text
   * spans this installer itself added.
   */
  readonly originalContent?: string;
}

export interface InstallState {
  readonly schemaVersion: 1;
  readonly installedAt: string;
  readonly sourceVersion: string;
  readonly sourceDigest: string;
  readonly artifacts: readonly ArtifactRecord[];
}

export function stateFilePath(targetDir: string): string {
  return join(targetDir, ".claude", "eo-install-state.json");
}

export function upgradeMarkerPath(targetDir: string): string {
  return `${stateFilePath(targetDir)}.upgrading`;
}

export function backupDir(targetDir: string): string {
  return join(targetDir, ".claude", "eo-install-backups");
}

/** Reads the state store, or `undefined` if this project has never been installed into. */
export async function readInstallState(targetDir: string): Promise<InstallState | undefined> {
  try {
    const raw = await readFile(stateFilePath(targetDir), "utf8");
    return JSON.parse(raw) as InstallState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Writes the state store, creating `.claude/` if necessary. */
export async function writeInstallState(targetDir: string, state: InstallState): Promise<void> {
  const path = stateFilePath(targetDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function removeInstallState(targetDir: string): Promise<void> {
  await rm(stateFilePath(targetDir), { force: true });
}

/** Marks an upgrade as in-progress (interrupted-upgrade recovery reads this back). Written BEFORE any artifact is touched; removed only after every artifact write in the batch succeeds. */
export async function writeUpgradeMarker(
  targetDir: string,
  pending: readonly ArtifactRecord[],
): Promise<void> {
  const path = upgradeMarkerPath(targetDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ pending }, null, 2)}\n`, "utf8");
}

export async function readUpgradeMarker(
  targetDir: string,
): Promise<{ readonly pending: readonly ArtifactRecord[] } | undefined> {
  try {
    const raw = await readFile(upgradeMarkerPath(targetDir), "utf8");
    return JSON.parse(raw) as { pending: readonly ArtifactRecord[] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function removeUpgradeMarker(targetDir: string): Promise<void> {
  await rm(upgradeMarkerPath(targetDir), { force: true });
}

/** Backs up `relPath`'s current on-disk content (if any) under `backupDir`, returning the backup's absolute path. Returns `undefined` if the file did not exist (nothing to back up). */
export async function backupArtifact(
  targetDir: string,
  relPath: string,
  content: string | undefined,
): Promise<string | undefined> {
  if (content === undefined) return undefined;
  const dir = backupDir(targetDir);
  await mkdir(dir, { recursive: true });
  const safeName = relPath.replace(/[/\\]/g, "__");
  const path = join(dir, `${safeName}.${Date.now()}.bak`);
  await writeFile(path, content, "utf8");
  return path;
}

/**
 * Restores `backupPath`'s content to `destPath`.
 *
 * ADVERSARIAL-REVIEW FIX (2026-07-24, CONFIRMED edge case): if a PRIOR
 * `recoverInterruptedUpgrade` run was itself killed after `deleteBackup`
 * but before `removeUpgradeMarker` (a "double interruption"), the marker
 * still lists this `backupPath`, but the backup file is already gone. A
 * re-run's `restoreBackup` used to throw an unhandled ENOENT in that case,
 * so recovery itself was not idempotent under a second fault. Now: a
 * missing backup is treated as "already restored/cleaned by a prior
 * partial recovery attempt" and is a documented no-op, never a throw —
 * `../upgrade.ts`'s `recoverInterruptedUpgrade` (and hence a second,
 * repeated recovery attempt) stays safe to call any number of times.
 */
export async function restoreBackup(backupPath: string, destPath: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(backupPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, content, "utf8");
}

export async function deleteBackup(backupPath: string): Promise<void> {
  await rm(backupPath, { force: true });
}

/** Atomically renames `tmpPath` onto `destPath` (write-then-rename pattern) — used so a mid-write kill never leaves a torn/partial artifact on disk. */
export async function atomicWriteFile(destPath: string, content: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.eo-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, destPath);
}

/**
 * Seeds a real, on-disk "interrupted upgrade" torn state — the exact
 * marker/backup shape `packages/cli/src/installer/state-store.ts`'s
 * `writeUpgradeMarker`/`backupArtifact` produce (that module is not
 * re-exported by `packages/cli`'s public barrel, so this file mirrors its
 * documented on-disk convention rather than importing it — see this
 * project's own report for why this is a deliberate, path-convention-level
 * reproduction rather than a missing-export gap: `packages/cli/src/
 * installer/upgrade.test.ts` itself uses the identical seeded-marker
 * technique, calling `writeUpgradeMarker` directly, since IT has internal
 * package access — this is the established pattern for testing this exact
 * recovery path in this codebase).
 *
 * The paths below (`.claude/eo-install-state.json.upgrading`,
 * `.claude/eo-install-backups/`) and the marker/backup JSON shapes are
 * copied verbatim from `state-store.ts`'s own doc comments/implementation,
 * read (never edited) as part of this work item.
 *
 * "Crash" simulation: a real kill -9 mid-write would leave EXACTLY this
 * on-disk shape (marker present, backup file(s) present, target file
 * either torn or simply not-yet-rewritten) — seeding it directly is what
 * `packages/cli`'s OWN test suite for this exact code path does
 * (`upgrade.test.ts`), since a live, precisely-timed kill -9 racing a
 * ~6-file write batch would be flaky by construction. The RECOVERY code
 * this project's scenarios exercise afterward (`runUpgrade` via real
 * `dispatchCommand`) is 100% real, non-test-only production logic; only
 * the crash's own on-disk aftermath is reproduced rather than induced live.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function stateFilePath(targetDir: string): string {
  return join(targetDir, ".claude", "eo-install-state.json");
}

export function upgradeMarkerPath(targetDir: string): string {
  return `${stateFilePath(targetDir)}.upgrading`;
}

export function backupDir(targetDir: string): string {
  return join(targetDir, ".claude", "eo-install-backups");
}

export interface SeededPendingArtifact {
  readonly relPath: string;
  readonly kind: "merged" | "full";
  /** The content a real `backupArtifact` call would have captured immediately before the interrupted write — `undefined` means "did not exist before this attempt" (no backup file). */
  readonly preUpgradeContent?: string;
}

export interface SeededTornUpgrade {
  readonly backupPaths: ReadonlyMap<string, string>;
}

/**
 * Writes a real backup file (when `preUpgradeContent` is supplied) plus the
 * real upgrade-marker JSON referencing it, for each of `pending` — the
 * exact torn state a kill between `writeUpgradeMarker` and
 * `removeUpgradeMarker` leaves (see `upgrade.ts`'s own doc comment,
 * verbatim: "writes an upgrade marker ... BEFORE touching any artifact,
 * and removes it only after every write in the batch succeeds").
 */
export async function seedInterruptedUpgrade(
  targetDir: string,
  pending: readonly SeededPendingArtifact[],
): Promise<SeededTornUpgrade> {
  const dir = backupDir(targetDir);
  await mkdir(dir, { recursive: true });

  const backupPaths = new Map<string, string>();
  const markerPending: Array<{
    relPath: string;
    kind: "merged" | "full";
    installedChecksum: string;
    sourceVersion: string;
    backupPath?: string;
  }> = [];

  for (const artifact of pending) {
    if (artifact.preUpgradeContent !== undefined) {
      const safeName = artifact.relPath.replace(/[/\\]/g, "__");
      const backupPath = join(dir, `${safeName}.seeded-crash.bak`);
      await writeFile(backupPath, artifact.preUpgradeContent, "utf8");
      backupPaths.set(artifact.relPath, backupPath);
      markerPending.push({
        relPath: artifact.relPath,
        kind: artifact.kind,
        installedChecksum: "",
        sourceVersion: "",
        backupPath,
      });
    } else {
      markerPending.push({
        relPath: artifact.relPath,
        kind: artifact.kind,
        installedChecksum: "",
        sourceVersion: "",
      });
    }
  }

  const markerPath = upgradeMarkerPath(targetDir);
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({ pending: markerPending }, null, 2)}\n`, "utf8");

  return { backupPaths };
}

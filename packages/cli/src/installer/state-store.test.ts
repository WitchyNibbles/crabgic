import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  atomicWriteFile,
  backupArtifact,
  deleteBackup,
  readInstallState,
  readUpgradeMarker,
  restoreBackup,
  stateFilePath,
  upgradeMarkerPath,
} from "./state-store.js";

const dirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-state-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("readInstallState — non-ENOENT errors propagate", () => {
  it("throws (does not swallow) when the state file exists but is malformed JSON", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(stateFilePath(dir), "not valid json {{{", "utf8");
    await expect(readInstallState(dir)).rejects.toThrow();
  });
});

describe("readUpgradeMarker — non-ENOENT errors propagate", () => {
  it("throws (does not swallow) when the marker file exists but is malformed JSON", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(upgradeMarkerPath(dir), "not valid json {{{", "utf8");
    await expect(readUpgradeMarker(dir)).rejects.toThrow();
  });
});

describe("backupArtifact", () => {
  it("returns undefined and writes nothing when content is undefined (nothing to back up)", async () => {
    const dir = await makeTmpDir();
    const backupPath = await backupArtifact(dir, "CLAUDE.md", undefined);
    expect(backupPath).toBeUndefined();
  });

  it("writes a real backup file and returns its path when content is present", async () => {
    const dir = await makeTmpDir();
    const backupPath = await backupArtifact(dir, "CLAUDE.md", "hello\n");
    expect(backupPath).toBeDefined();
    expect(await readFile(backupPath!, "utf8")).toBe("hello\n");
  });
});

describe("restoreBackup / deleteBackup", () => {
  it("restores a backup's content to a destination path, then deletes the backup", async () => {
    const dir = await makeTmpDir();
    const backupPath = await backupArtifact(dir, "CLAUDE.md", "original\n");
    const destPath = join(dir, "CLAUDE.md");
    await restoreBackup(backupPath!, destPath);
    expect(await readFile(destPath, "utf8")).toBe("original\n");
    await deleteBackup(backupPath!);
    await expect(readFile(backupPath!, "utf8")).rejects.toThrow();
  });

  it("ADVERSARIAL-REVIEW REGRESSION (2026-07-24, CONFIRMED edge): tolerates a missing backup file as a no-op, never throws (double-interrupted recovery)", async () => {
    const dir = await makeTmpDir();
    const missingBackupPath = join(dir, "eo-install-backups", "already-deleted.bak");
    const destPath = join(dir, "CLAUDE.md");
    await writeFile(destPath, "whatever is already there\n", "utf8");

    await expect(restoreBackup(missingBackupPath, destPath)).resolves.toBeUndefined();
    // Untouched — restoreBackup made no attempt to write over it from a backup that doesn't exist.
    expect(await readFile(destPath, "utf8")).toBe("whatever is already there\n");
  });
});

describe("atomicWriteFile", () => {
  it("writes content that is fully readable back (write-then-rename)", async () => {
    const dir = await makeTmpDir();
    const destPath = join(dir, "nested", "CLAUDE.md");
    await atomicWriteFile(destPath, "content\n");
    expect(await readFile(destPath, "utf8")).toBe("content\n");
  });
});

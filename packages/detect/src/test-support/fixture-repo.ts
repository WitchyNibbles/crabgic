/**
 * Real, on-disk fixture-tree builder shared by this package's own test
 * suite — mirrors `packages/git-engine/src/test-support/fixture-repo.ts`'s
 * convention (temp dir + explicit cleanup) but never shells out to `git`:
 * this package's detectors and quarantine pipeline only ever read plain
 * files, never a repo's version-control history.
 *
 * Not part of this package's public barrel (`../index.ts`) — test
 * scaffolding only.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Creates a fresh temp directory under the OS tmpdir, tracked for cleanup by the caller. */
export function freshTmpDir(prefix = "eo-detect-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes `content` to `relativePath` inside `rootDir`, creating parent directories as needed. */
export function writeFixtureFile(rootDir: string, relativePath: string, content: string): string {
  const fullPath = join(rootDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

/** Writes `content` to `relativePath` and marks it executable (0o755) — for "executable postinstall script" fixtures. */
export function writeExecutableFixtureFile(
  rootDir: string,
  relativePath: string,
  content: string,
): string {
  const fullPath = writeFixtureFile(rootDir, relativePath, content);
  chmodSync(fullPath, 0o755);
  return fullPath;
}

/** Creates a symlink at `relativePath` pointing at `target` (absolute or relative) — for symlink-escape guard tests. */
export function writeFixtureSymlink(rootDir: string, relativePath: string, target: string): void {
  const fullPath = join(rootDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  symlinkSync(target, fullPath);
}

/** Recursively removes a directory tree, tolerating an already-missing path. */
export function removeDirTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

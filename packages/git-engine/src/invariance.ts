/**
 * Invariance harness — roadmap/07-git-control-repo-worktrees.md work item
 * 2: "an EXPORTED reusable before/after tree-hash assertion utility (08 and
 * 23 reuse it directly)." Also this package's own Conformance requirement:
 * every test in this suite wraps its operation in `withTreeInvariance`
 * (directly, or by asserting `computeWorkingTreeHash` before/after) so the
 * user checkout's tree-hash is proven identical before/after every
 * engine operation, not just the ones with a dedicated exit criterion.
 *
 * Deliberately NOT a git-internal hash (`git write-tree` etc.): those
 * require the index to already match the working tree and can themselves
 * mutate `.git/index` as a side effect — exactly the kind of accidental
 * touch this harness exists to catch. Instead this is a plain,
 * git-independent content digest: every regular file's path (relative,
 * POSIX-normalized) and byte content, sorted deterministically, folded
 * into one SHA-256 hex digest. Sensitive to added/removed/modified files,
 * insensitive to traversal order.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface TreeHashOptions {
  /** Directory (base)names excluded from the walk entirely (contents never hashed). Default: [".git"]. */
  readonly ignoreDirNames?: readonly string[];
}

const DEFAULT_IGNORE_DIR_NAMES: readonly string[] = [".git"];

export class TreeMutatedError extends Error {
  readonly rootPath: string;
  readonly beforeHash: string;
  readonly afterHash: string;

  constructor(rootPath: string, beforeHash: string, afterHash: string) {
    super(
      `invariance: working tree at "${rootPath}" changed (before=${beforeHash}, after=${afterHash}) — an engine operation was expected to leave it byte-identical`,
    );
    this.name = "TreeMutatedError";
    this.rootPath = rootPath;
    this.beforeHash = beforeHash;
    this.afterHash = afterHash;
  }
}

type CollectedEntryKind = "file" | "symlink";

interface CollectedEntry {
  readonly absPath: string;
  readonly kind: CollectedEntryKind;
}

/**
 * MINOR 5 fix (2026-07-18 adversarial validation round): symlinks are now
 * COLLECTED (as their own entry kind, never followed/traversed-into) rather
 * than silently skipped — a symlink swap (e.g. a tracked file replaced by a
 * symlink pointing somewhere else) previously left this harness blind: the
 * "before" walk saw a file, the "after" walk saw nothing at all (symlinks
 * matched neither `isDirectory()` nor `isFile()`), and neither hash
 * reflected the symlink's own existence or target.
 */
function collectEntries(rootPath: string, ignoreDirNames: readonly string[]): CollectedEntry[] {
  const results: CollectedEntry[] = [];
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        results.push({ absPath, kind: "symlink" });
        continue; // never follow — the link itself is the unit hashed, not its target's tree
      }
      if (entry.isDirectory()) {
        if (ignoreDirNames.includes(entry.name)) continue;
        walk(absPath);
      } else if (entry.isFile()) {
        results.push({ absPath, kind: "file" });
      }
    }
  }
  walk(rootPath);
  return results;
}

/**
 * Computes a deterministic SHA-256 digest over every regular file's
 * relative path + content, AND every symlink's relative path + link target
 * (MINOR 5 fix — symlinks previously skipped entirely), under `rootPath`,
 * excluding `options.ignoreDirNames` (default `[".git"]`). Two calls
 * against an unchanged tree always agree; any add/remove/modify of a
 * tracked file OR a symlink retarget changes the result.
 */
export async function computeWorkingTreeHash(
  rootPath: string,
  options: TreeHashOptions = {},
): Promise<string> {
  const ignoreDirNames = options.ignoreDirNames ?? DEFAULT_IGNORE_DIR_NAMES;
  const entries = collectEntries(rootPath, ignoreDirNames)
    .map((entry) => ({
      relPath: relative(rootPath, entry.absPath).split(sep).join("/"),
      kind: entry.kind,
      absPath: entry.absPath,
    }))
    .sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  const hash = createHash("sha256");
  for (const entry of entries) {
    if (entry.kind === "symlink") {
      const target = readlinkSync(entry.absPath);
      hash.update(`symlink:${entry.relPath}\ntarget:${target}\n--\n`);
      continue;
    }
    const stat = statSync(entry.absPath);
    const content = readFileSync(entry.absPath);
    hash.update(`path:${entry.relPath}\nsize:${stat.size}\n`);
    hash.update(content);
    hash.update("\n--\n");
  }
  return hash.digest("hex");
}

/** Throws `TreeMutatedError` if `rootPath`'s current hash differs from `beforeHash`. */
export async function assertTreeInvariant(
  rootPath: string,
  beforeHash: string,
  options: TreeHashOptions = {},
): Promise<void> {
  const afterHash = await computeWorkingTreeHash(rootPath, options);
  if (afterHash !== beforeHash) {
    throw new TreeMutatedError(rootPath, beforeHash, afterHash);
  }
}

/**
 * Wraps `fn`: hashes `rootPath` before, runs `fn`, asserts the hash is
 * unchanged after, then returns `fn`'s result. The exported entry point 08
 * and 23 reuse directly (roadmap §Interfaces produced).
 */
export async function withTreeInvariance<T>(
  rootPath: string,
  fn: () => Promise<T> | T,
  options: TreeHashOptions = {},
): Promise<T> {
  const beforeHash = await computeWorkingTreeHash(rootPath, options);
  const result = await fn();
  await assertTreeInvariant(rootPath, beforeHash, options);
  return result;
}

/**
 * MINOR 5 fix (2026-07-18 adversarial validation round): `computeWorkingTreeHash`
 * is deliberately `.git`-blind (a plain, git-independent content digest —
 * see this file's top-of-file doc comment for why). That means it CANNOT,
 * by itself, detect a mutation of `.git`'s own load-bearing state — exactly
 * what let MINOR 4 (freeze mutating the user checkout's `.git/index`) go
 * undetected by the invariance harness even though the harness existed.
 * `computeGitStateHash` closes that gap for operations that touch a real
 * git checkout: it hashes `HEAD`, `config`, `index` (when present — an
 * unborn/very-fresh repo may not have one yet), `packed-refs` (when
 * present), and every loose ref file under `refs/`, in one deterministic
 * digest. This is intentionally a SEPARATE function from
 * `computeWorkingTreeHash`, not a parameter on it — most of this package's
 * own tests operate on control-owned dirs or plain fixture trees that are
 * not "a user checkout" in the roadmap's own sense, so most call sites
 * should keep using the git-independent, `.git`-blind working-tree hash
 * alone (see `withUserCheckoutInvariance` below for the combined form, used
 * specifically around the ONE operation that reads a real user checkout).
 */
const GIT_STATE_FILES: readonly string[] = ["HEAD", "config", "index", "packed-refs"];

function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile()) {
        results.push(absPath);
      }
    }
  }
  walk(dir);
  return results;
}

/**
 * Hashes the load-bearing `.git` state under `repoPath/.git`: `HEAD`,
 * `config`, `index`, `packed-refs` (each only if present), and every loose
 * ref file under `refs/`. A refs/config/index mutation this package must
 * never cause against a USER checkout changes this hash even when
 * `computeWorkingTreeHash` alone (which is `.git`-blind by design) would
 * not catch it.
 */
export async function computeGitStateHash(repoPath: string): Promise<string> {
  const gitDir = join(repoPath, ".git");
  const hash = createHash("sha256");

  for (const name of GIT_STATE_FILES) {
    const filePath = join(gitDir, name);
    if (!existsSync(filePath)) continue;
    hash.update(`file:${name}\n`);
    hash.update(readFileSync(filePath));
    hash.update("\n--\n");
  }

  const refsDir = join(gitDir, "refs");
  const looseRefRelPaths = listFilesRecursive(refsDir)
    .map((absPath) => relative(gitDir, absPath).split(sep).join("/"))
    .sort();
  for (const relPath of looseRefRelPaths) {
    hash.update(`file:${relPath}\n`);
    hash.update(readFileSync(join(gitDir, relPath)));
    hash.update("\n--\n");
  }

  return hash.digest("hex");
}

async function computeUserCheckoutHash(
  repoPath: string,
  options: TreeHashOptions,
): Promise<string> {
  const [treeHash, gitStateHash] = await Promise.all([
    computeWorkingTreeHash(repoPath, options),
    computeGitStateHash(repoPath),
  ]);
  return `${treeHash}:${gitStateHash}`;
}

/**
 * The STRENGTHENED invariance wrapper for operations that read a real USER
 * checkout (MINOR 5 fix) — combines `computeWorkingTreeHash` (working tree,
 * `.git`-blind) with `computeGitStateHash` (`.git`'s own load-bearing
 * state: HEAD/refs/config/index) into one before/after assertion, so a
 * mutation of EITHER axis is detected. Applied specifically around
 * `freezeIntake` in `./intake-freeze.test.ts` — the one operation in this
 * package's own suite that reads a real user checkout — proving MINOR 4's
 * fix (the user's `.git/index` is now provably unchanged, not just
 * "probably fine").
 */
export async function withUserCheckoutInvariance<T>(
  repoPath: string,
  fn: () => Promise<T> | T,
  options: TreeHashOptions = {},
): Promise<T> {
  const beforeHash = await computeUserCheckoutHash(repoPath, options);
  const result = await fn();
  const afterHash = await computeUserCheckoutHash(repoPath, options);
  if (afterHash !== beforeHash) {
    throw new TreeMutatedError(repoPath, beforeHash, afterHash);
  }
  return result;
}

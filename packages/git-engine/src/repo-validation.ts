/**
 * Repository-validation checks — roadmap/07-git-control-repo-worktrees.md
 * work item 3: "Repository-validation checks on top of the plumbing
 * wrapper: unborn HEAD, SHA-256 object-format repos, submodules, LFS
 * pointers (no smudge in control context), `core.hooksPath` neutralization
 * (empty)." Every check is plumbing-based (spawns real `git`), never a
 * bare `.git`-directory-presence heuristic.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { USER_CHECKOUT_READ_ENV } from "./git-arg-guard.js";
import type { GitPlumbing } from "./plumbing.js";

export interface RepositoryValidationReport {
  readonly hasUnbornHead: boolean;
  readonly objectFormat: "sha1" | "sha256";
  readonly hasSubmodules: boolean;
  readonly lfsPointerPaths: readonly string[];
  readonly hooksPathNeutralized: boolean;
}

/** The exact opening line git-lfs writes into every pointer file it tracks (spec v1) — detecting this string is how a pointer is recognized without ever invoking `git-lfs smudge`. */
const LFS_POINTER_SIGNATURE = "version https://git-lfs.github.com/spec/v1";

async function detectUnbornHead(plumbing: GitPlumbing, repoPath: string): Promise<boolean> {
  const symbolicRef = await plumbing.run(["symbolic-ref", "-q", "HEAD"], {
    cwd: repoPath,
    allowFailure: true,
  });
  if (symbolicRef.exitCode !== 0) {
    // Detached HEAD pointing at a real commit, or some other odd state —
    // not the "unborn" shape this check targets.
    return false;
  }
  const revParse = await plumbing.run(["rev-parse", "-q", "--verify", "HEAD"], {
    cwd: repoPath,
    allowFailure: true,
  });
  return revParse.exitCode !== 0;
}

async function detectObjectFormat(
  plumbing: GitPlumbing,
  repoPath: string,
): Promise<"sha1" | "sha256"> {
  const result = await plumbing.run(["rev-parse", "--show-object-format"], {
    cwd: repoPath,
    allowFailure: true,
  });
  const value = result.stdout.trim();
  return value === "sha256" ? "sha256" : "sha1";
}

function detectSubmodules(repoPath: string): boolean {
  return existsSync(join(repoPath, ".gitmodules"));
}

async function detectLfsPointerPaths(
  plumbing: GitPlumbing,
  repoPath: string,
): Promise<readonly string[]> {
  // MINOR 4 fix (2026-07-18 adversarial validation round): `validateRepository`
  // is called against the USER checkout by `intake-freeze.ts`'s
  // `freezeIntake` — this `ls-files` read must never mutate `.git/index`
  // as a side effect, same reasoning as `intake-freeze.ts`'s own `status`
  // call (belt-and-suspenders: `--no-optional-locks` flag + `GIT_OPTIONAL_LOCKS=0` env).
  const lsFiles = await plumbing.run(["--no-optional-locks", "ls-files"], {
    cwd: repoPath,
    allowFailure: true,
    env: USER_CHECKOUT_READ_ENV,
  });
  if (lsFiles.exitCode !== 0) return [];
  const trackedPaths = lsFiles.stdout.split("\n").filter((p) => p.length > 0);
  const pointerPaths: string[] = [];
  for (const relPath of trackedPaths) {
    const fullPath = join(repoPath, relPath);
    if (!existsSync(fullPath)) continue;
    let head: string;
    try {
      head = readFileSync(fullPath, "utf8").slice(0, LFS_POINTER_SIGNATURE.length + 4);
    } catch {
      continue; // e.g. a directory entry from ls-files edge cases, or binary read failure
    }
    if (head.startsWith(LFS_POINTER_SIGNATURE)) {
      pointerPaths.push(relPath);
    }
  }
  return pointerPaths;
}

async function detectHooksPathNeutralized(
  plumbing: GitPlumbing,
  repoPath: string,
): Promise<boolean> {
  const result = await plumbing.run(["config", "--get", "core.hooksPath"], {
    cwd: repoPath,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    // Unset — default `.git/hooks` applies, which could contain live
    // hooks. Not neutralized.
    return false;
  }
  return result.stdout.trim() === "";
}

/** Runs every check and returns the combined report. Never throws for a "bad" shape — every finding is a report field, not an exception; callers decide what to do with a positive finding. */
export async function validateRepository(
  plumbing: GitPlumbing,
  repoPath: string,
): Promise<RepositoryValidationReport> {
  const [hasUnbornHead, objectFormat, lfsPointerPaths, hooksPathNeutralized] = await Promise.all([
    detectUnbornHead(plumbing, repoPath),
    detectObjectFormat(plumbing, repoPath),
    detectLfsPointerPaths(plumbing, repoPath),
    detectHooksPathNeutralized(plumbing, repoPath),
  ]);
  return {
    hasUnbornHead,
    objectFormat,
    hasSubmodules: detectSubmodules(repoPath),
    lfsPointerPaths,
    hooksPathNeutralized,
  };
}

/**
 * Sets `core.hooksPath` to the empty string, disabling every local hook —
 * roadmap's "filters/hooks neutralized in control context." A repo-local
 * config write only; never touches global git config.
 */
export async function neutralizeHooksPath(plumbing: GitPlumbing, repoPath: string): Promise<void> {
  await plumbing.run(["config", "core.hooksPath", ""], { cwd: repoPath });
}

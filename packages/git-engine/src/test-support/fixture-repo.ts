/**
 * Real, on-disk git fixture-repo builder shared by this package's own test
 * suite (roadmap/07-git-control-repo-worktrees.md Test plan: "Integration
 * over REAL on-disk fixture git repos... no mocked git"). Deliberately uses
 * `node:child_process.execFileSync` directly (argv array, no shell — same
 * security posture as `../plumbing.ts`, just not routed through the
 * plumbing wrapper itself, since fixture setup must not depend on the very
 * module under test in WI1's own RED phase).
 *
 * Not part of this package's public barrel (`../index.ts`) — test scaffolding
 * only.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs `git <args>` in `cwd`, argv-array only, no shell. Throws on non-zero exit. */
export function fixtureGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Creates a fresh temp directory under the OS tmpdir, tracked for cleanup by the caller. */
export function freshTmpDir(prefix = "eo-git-engine-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface FixtureRepoOptions {
  readonly objectFormat?: "sha1" | "sha256";
  readonly bare?: boolean;
}

/** Initializes a real git repo in a fresh temp dir with a local, repo-scoped identity (never touches global git config). */
export function initFixtureRepo(options: FixtureRepoOptions = {}): string {
  const dir = freshTmpDir();
  const initArgs = ["init", "-q"];
  if (options.objectFormat !== undefined) initArgs.push(`--object-format=${options.objectFormat}`);
  if (options.bare === true) initArgs.push("--bare");
  fixtureGit(dir, initArgs);
  if (options.bare !== true) {
    fixtureGit(dir, ["config", "user.name", "EO Fixture"]);
    fixtureGit(dir, ["config", "user.email", "fixture@eo.invalid"]);
    fixtureGit(dir, ["config", "commit.gpgsign", "false"]);
  }
  return dir;
}

/** Writes `content` to `relativePath` inside `repoDir`, creating parent directories as needed. */
export function writeFixtureFile(repoDir: string, relativePath: string, content: string): string {
  const fullPath = join(repoDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

/** `git add -A && git commit -m <message>`, returning the new commit's object id. */
export function commitAll(repoDir: string, message: string): string {
  fixtureGit(repoDir, ["add", "-A"]);
  fixtureGit(repoDir, ["commit", "-q", "-m", message, "--no-verify"]);
  return fixtureGit(repoDir, ["rev-parse", "HEAD"]).trim();
}

/** Builds a small, non-trivial fixture repo: one commit with two tracked files, on branch `main`. Returns the repo dir and the commit's object id. */
export function buildBasicFixtureRepo(): { readonly dir: string; readonly headObjectId: string } {
  const dir = initFixtureRepo();
  fixtureGit(dir, ["checkout", "-q", "-b", "main"]);
  writeFixtureFile(dir, "README.md", "# fixture\n");
  writeFixtureFile(dir, "src/a.txt", "alpha\n");
  const headObjectId = commitAll(dir, "initial commit");
  return { dir, headObjectId };
}

/** Recursively removes a directory tree, tolerating a already-missing path. */
export function removeDirTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

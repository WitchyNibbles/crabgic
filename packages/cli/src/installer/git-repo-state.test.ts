import { GIT_FIXTURE_IDENTITY_ENV, runFixtureGit } from "@crabgic/testkit";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectGitRepoState, detectMonorepo, performGitInit } from "./git-repo-state.js";

/**
 * Every git call below goes through `runFixtureGit`, never a bare
 * `execFile("git", ...)`. `{ cwd: dir }` does NOT isolate a git subprocess:
 * git resolves its repository from `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`
 * before it consults the working directory, and git exports `GIT_DIR` into
 * every hook it runs — including this repo's `pre-push` hook, which runs the
 * whole suite. Until 2026-08-01 the `init`/`config`/`commit` sequence here
 * re-initialized the real repository, overwrote its committer identity, and
 * landed junk commits on the branch being pushed. Identity now comes from
 * `GIT_FIXTURE_IDENTITY_ENV` rather than `git config`, so there is no
 * config-writing command left to mis-aim at all. See
 * `@crabgic/testkit`'s `git-env.ts`.
 */

/** `git <args>` in a fixture dir: scrubbed environment, identity by env, no config writes. */
function git(dir: string, args: readonly string[]): void {
  runFixtureGit(dir, args, { env: GIT_FIXTURE_IDENTITY_ENV });
}

const dirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-git-repo-state-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("detectGitRepoState", () => {
  it('reports "not-a-repo" for an empty directory with no .git at all', async () => {
    const dir = makeTmpDir();
    expect(await detectGitRepoState(dir)).toBe("not-a-repo");
  });

  it('reports "invalid-git" for a directory with a corrupt .git', async () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "not a valid git ref file at all");
    expect(await detectGitRepoState(dir)).toBe("invalid-git");
  });

  it('reports "unborn-head" for a freshly-initialized repo with zero commits', async () => {
    const dir = makeTmpDir();
    git(dir, ["init"]);
    expect(await detectGitRepoState(dir)).toBe("unborn-head");
  });

  it('reports "clean" for a repo with one commit and no working-tree changes', async () => {
    const dir = makeTmpDir();
    git(dir, ["init"]);
    writeFileSync(join(dir, "a.txt"), "a");
    git(dir, ["add", "a.txt"]);
    git(dir, ["commit", "-m", "init", "--no-verify"]);
    expect(await detectGitRepoState(dir)).toBe("clean");
  });

  it('reports "dirty" for a repo with uncommitted working-tree changes', async () => {
    const dir = makeTmpDir();
    git(dir, ["init"]);
    writeFileSync(join(dir, "a.txt"), "a");
    git(dir, ["add", "a.txt"]);
    git(dir, ["commit", "-m", "init", "--no-verify"]);
    writeFileSync(join(dir, "a.txt"), "modified");
    expect(await detectGitRepoState(dir)).toBe("dirty");
  });
});

describe("performGitInit", () => {
  it("initializes a real git repo", async () => {
    const dir = makeTmpDir();
    await performGitInit(dir);
    expect(await detectGitRepoState(dir)).toBe("unborn-head");
  });

  /**
   * `performGitInit` is the single most destructive call in the installer:
   * `crabgic install` runs it against a user-chosen `targetDir`, and git
   * resolves which repository `init` acts on from `GIT_DIR` BEFORE it looks
   * at `cwd`. With an ambient `GIT_DIR` inherited — from a wrapper script, a
   * parent git process, or any hook, since git exports `GIT_DIR` to every
   * hook it runs — an "install into this empty folder" would instead
   * re-initialize the caller's own repository, and when that `GIT_DIR` names
   * a linked worktree it writes `core.bare = true` into the shared config and
   * breaks `git status` there outright.
   *
   * This is a BEHAVIORAL guard on the production call, deliberately not
   * satisfied by the repo-wide hygiene scan: that scan only proves
   * `GIT_LOCATION_ENV_VARS` appears somewhere in the file, so deleting
   * `env: targetDirOnlyEnv()` from this one call site while leaving the
   * constant defined would keep every static check green.
   */
  it("a poisoned ambient GIT_DIR cannot redirect the init away from targetDir", async () => {
    const victim = makeTmpDir();
    git(victim, ["init", "-q", "-b", "main"]);
    writeFileSync(join(victim, "real.txt"), "real work");
    git(victim, ["add", "real.txt"]);
    git(victim, ["commit", "-q", "-m", "legitimate commit", "--no-verify"]);

    const victimGitDir = join(victim, ".git");
    const before = {
      head: runFixtureGit(victim, ["rev-parse", "HEAD"]).trim(),
      commitCount: runFixtureGit(victim, ["rev-list", "--count", "HEAD"]).trim(),
      config: readFileSync(join(victimGitDir, "config"), "utf8"),
    };

    const target = makeTmpDir();
    const original = process.env["GIT_DIR"];
    process.env["GIT_DIR"] = victimGitDir;
    try {
      await performGitInit(target);
    } finally {
      if (original === undefined) delete process.env["GIT_DIR"];
      else process.env["GIT_DIR"] = original;
    }

    // The init landed in `targetDir`...
    expect(existsSync(join(target, ".git"))).toBe(true);
    expect(await detectGitRepoState(target)).toBe("unborn-head");
    // ...and the repository `GIT_DIR` pointed at is byte-identical.
    expect({
      head: runFixtureGit(victim, ["rev-parse", "HEAD"]).trim(),
      commitCount: runFixtureGit(victim, ["rev-list", "--count", "HEAD"]).trim(),
      config: readFileSync(join(victimGitDir, "config"), "utf8"),
    }).toEqual(before);
  });
});

describe("detectMonorepo", () => {
  it("is false for a directory with no nested package.json", () => {
    const dir = makeTmpDir();
    expect(detectMonorepo(dir)).toBe(false);
  });

  it("is true when a subdirectory has its own package.json", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, "packages", "sub"), { recursive: true });
    writeFileSync(join(dir, "packages", "sub", "package.json"), "{}");
    expect(detectMonorepo(dir)).toBe(true);
  });
});

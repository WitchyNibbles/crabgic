import { GIT_FIXTURE_IDENTITY_ENV, runFixtureGit } from "@crabgic/testkit";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

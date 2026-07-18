import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveXdgCacheHome, type XdgEnv } from "@eo/journal";
import { ensureControlClone, fetchRefresh } from "./control-clone.js";
import { GIT_CONTROL_SUBDIR, resolveGitControlDir } from "./layout.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
} from "./test-support/fixture-repo.js";

/**
 * WI5 (control-clone half) — roadmap/07-git-control-repo-worktrees.md work
 * item 5: "Failing-test-first" is satisfied here by the integration test
 * against a fresh control dir, which fails while `ensureControlClone`'s
 * stub never actually clones. The path-convention exit criterion ("Control
 * clone resolves at `$XDG_CACHE_HOME/.../<project-hash>/git-control/`") is
 * its own dedicated test below.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

describe("resolveGitControlDir — path convention (Gap 14, WI5 exit criterion)", () => {
  it("resolves at $XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/", () => {
    const env: XdgEnv = { HOME: "/home/fixture-user", XDG_CACHE_HOME: "/custom/cache" };
    const projectHash = "abc123hash";
    const resolved = resolveGitControlDir(env, projectHash);
    expect(resolved).toBe(
      join(resolveXdgCacheHome(env), "engineering-orchestrator", projectHash, "git-control"),
    );
    expect(GIT_CONTROL_SUBDIR).toBe("git-control");
  });
});

describe("ensureControlClone (WI5)", () => {
  it("clones a fresh control repo via `git clone --no-local`", async () => {
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");

    const result = await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    expect(result.created).toBe(true);
    expect(existsSync(join(controlDir, ".git"))).toBe(true);
    const log = await plumbing.run(["log", "-1", "--format=%H"], { cwd: controlDir });
    expect(log.stdout.trim()).toHaveLength(40);
  });

  it("never uses shared object alternates (no .git/objects/info/alternates file)", async () => {
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");

    await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    expect(existsSync(join(controlDir, ".git", "objects", "info", "alternates"))).toBe(false);
  });

  it("neutralizes core.hooksPath on the freshly cloned control repo", async () => {
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");

    await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    const hooksPath = await plumbing.run(["config", "--get", "core.hooksPath"], {
      cwd: controlDir,
    });
    expect(hooksPath.stdout.trim()).toBe("");
  });

  it("is idempotent: calling again against an already-cloned dir reports created=false and does not re-clone", async () => {
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");

    const first = await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });
    const second = await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it("calls onStep at each internal checkpoint, in order", async () => {
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");
    const steps: string[] = [];

    await ensureControlClone(plumbing, {
      sourceRepoPath: sourceDir,
      controlDir,
      onStep: (s) => steps.push(s),
    });

    expect(steps).toEqual([
      "before-clone",
      "after-clone-before-hooks-neutralize",
      "after-hooks-neutralize-before-done",
    ]);
  });
});

describe("fetchRefresh (WI5)", () => {
  it("fetches an updated target ref from the source repo and returns the fetched object id", async () => {
    const { dir: sourceDir, headObjectId: firstHead } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");
    await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    // Advance the source repo past what the control clone has.
    fixtureGit(sourceDir, ["checkout", "-q", "main"]);
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(sourceDir, "src", "a.txt"), "alpha-v2\n"),
    );
    fixtureGit(sourceDir, ["add", "-A"]);
    fixtureGit(sourceDir, ["commit", "-q", "-m", "second commit", "--no-verify"]);
    const secondHead = fixtureGit(sourceDir, ["rev-parse", "HEAD"]).trim();

    const fetchedObjectId = await fetchRefresh(plumbing, controlDir, "main");

    expect(fetchedObjectId).toBe(secondHead);
    expect(fetchedObjectId).not.toBe(firstHead);
  });
});

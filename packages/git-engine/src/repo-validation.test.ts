import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { neutralizeHooksPath, validateRepository } from "./repo-validation.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  initFixtureRepo,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * WI3 — roadmap/07-git-control-repo-worktrees.md work item 3: "Failing-
 * test-first: each fixture repo shape fails validation until its specific
 * check exists." Each `it` below targets exactly one of the five checks
 * this work item requires: unborn HEAD, SHA-256 object format, submodules,
 * LFS pointers, `core.hooksPath` neutralization.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

describe("validateRepository (WI3)", () => {
  it("a normal repo with a commit has no unborn HEAD", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.hasUnbornHead).toBe(false);
  });

  it("a detached HEAD (not unborn — symbolic-ref itself fails) is never misreported as unborn", async () => {
    const { dir, headObjectId } = buildBasicFixtureRepo();
    dirs.push(dir);
    fixtureGit(dir, ["checkout", "-q", "--detach", headObjectId]);
    const report = await validateRepository(plumbing, dir);
    expect(report.hasUnbornHead).toBe(false);
  });

  it("detects unborn HEAD on a freshly-init'd repo with zero commits", async () => {
    const dir = initFixtureRepo();
    dirs.push(dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.hasUnbornHead).toBe(true);
  });

  it("detects SHA-1 object format on a default-init'd repo", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.objectFormat).toBe("sha1");
  });

  it("detects SHA-256 object format on a repo initialized with --object-format=sha256", async () => {
    const dir = initFixtureRepo({ objectFormat: "sha256" });
    dirs.push(dir);
    writeFixtureFile(dir, "a.txt", "alpha\n");
    fixtureGit(dir, ["add", "-A"]);
    fixtureGit(dir, ["commit", "-q", "-m", "init", "--no-verify"]);
    const report = await validateRepository(plumbing, dir);
    expect(report.objectFormat).toBe("sha256");
  });

  it("a normal repo (no .gitmodules) reports no submodules", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.hasSubmodules).toBe(false);
  });

  it("detects a submodule shape (.gitmodules present)", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    writeFixtureFile(
      dir,
      ".gitmodules",
      '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = https://example.invalid/lib.git\n',
    );
    fixtureGit(dir, ["add", "-A"]);
    fixtureGit(dir, ["commit", "-q", "-m", "add submodule config", "--no-verify"]);
    const report = await validateRepository(plumbing, dir);
    expect(report.hasSubmodules).toBe(true);
  });

  it("a normal repo has no LFS pointer files", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.lfsPointerPaths).toEqual([]);
  });

  it("detects an LFS pointer file by its content signature (no smudge required)", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const pointerBody =
      "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 12345\n";
    writeFixtureFile(dir, "assets/big.bin", pointerBody);
    fixtureGit(dir, ["add", "-A"]);
    fixtureGit(dir, ["commit", "-q", "-m", "add lfs pointer", "--no-verify"]);
    const report = await validateRepository(plumbing, dir);
    expect(report.lfsPointerPaths).toContain("assets/big.bin");
  });

  it("core.hooksPath is NOT neutralized by default", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.hooksPathNeutralized).toBe(false);
  });

  it("neutralizeHooksPath makes core.hooksPath report neutralized", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    await neutralizeHooksPath(plumbing, dir);
    const report = await validateRepository(plumbing, dir);
    expect(report.hooksPathNeutralized).toBe(true);
  });

  it("neutralizeHooksPath actually prevents a hook from firing", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const marker = join(dir, "hook-fired.marker");
    const hooksDir = join(dir, ".git", "hooks");
    writeFixtureFile(dir, ".git/hooks/pre-commit", `#!/bin/sh\ntouch "${marker}"\n`);
    fixtureGit(dir, ["config", "core.hooksPath", hooksDir]);
    await import("node:fs").then((fs) =>
      fs.chmodSync(join(dir, ".git", "hooks", "pre-commit"), 0o755),
    );

    await neutralizeHooksPath(plumbing, dir);
    writeFixtureFile(dir, "trigger.txt", "x\n");
    fixtureGit(dir, ["add", "-A"]);
    fixtureGit(dir, ["commit", "-q", "-m", "trigger commit", "--no-verify"]);

    expect(existsSync(marker)).toBe(false);
  });
});

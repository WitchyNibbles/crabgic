import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertTreeInvariant,
  computeGitStateHash,
  computeWorkingTreeHash,
  TreeMutatedError,
  withTreeInvariance,
  withUserCheckoutInvariance,
} from "./invariance.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
} from "./test-support/fixture-repo.js";

/**
 * WI2 — roadmap/07-git-control-repo-worktrees.md work item 2: "Failing-
 * test-first: a deliberately mutated fixture tree must fail the harness
 * before the harness is trusted by any later work item's own tests." This
 * harness is also the Conformance requirement's own engine: every other
 * test file in this package wraps its operation in `withTreeInvariance`.
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

function freshFixtureTree(): string {
  const dir = freshTmpDir();
  dirs.push(dir);
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "a.txt"), "alpha\n");
  writeFileSync(join(dir, "nested", "b.txt"), "beta\n");
  return dir;
}

describe("computeWorkingTreeHash / assertTreeInvariant (WI2)", () => {
  it("is deterministic: hashing an unchanged tree twice yields the same hash", async () => {
    const dir = freshFixtureTree();
    const h1 = await computeWorkingTreeHash(dir);
    const h2 = await computeWorkingTreeHash(dir);
    expect(h1).toBe(h2);
  });

  it("changes when a file's content is mutated", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir);
    writeFileSync(join(dir, "a.txt"), "ALPHA-MUTATED\n");
    const after = await computeWorkingTreeHash(dir);
    expect(after).not.toBe(before);
  });

  it("changes when a new file is added", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir);
    writeFileSync(join(dir, "new-file.txt"), "new\n");
    const after = await computeWorkingTreeHash(dir);
    expect(after).not.toBe(before);
  });

  it("changes when a file is deleted", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir);
    rmSync(join(dir, "a.txt"));
    const after = await computeWorkingTreeHash(dir);
    expect(after).not.toBe(before);
  });

  it("assertTreeInvariant THROWS TreeMutatedError against a deliberately mutated fixture tree (the RED-proving case)", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir);
    writeFileSync(join(dir, "a.txt"), "MUTATED — this must be caught\n");
    await expect(assertTreeInvariant(dir, before)).rejects.toBeInstanceOf(TreeMutatedError);
  });

  it("assertTreeInvariant resolves cleanly when nothing changed", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir);
    await expect(assertTreeInvariant(dir, before)).resolves.toBeUndefined();
  });

  it("ignores excluded directory names (e.g. .git) when computing the hash", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir, { ignoreDirNames: [".git"] });
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    const after = await computeWorkingTreeHash(dir, { ignoreDirNames: [".git"] });
    expect(after).toBe(before);
  });

  /**
   * MINOR 5 fix (2026-07-18 adversarial validation round): symlinks were
   * previously skipped entirely — neither followed nor hashed — so a
   * symlink swap (a tracked FILE replaced by a SYMLINK, or a symlink
   * retargeted) went completely undetected by this harness.
   */
  it("changes when a symlink is added (previously invisible to this harness)", async () => {
    const dir = freshFixtureTree();
    const before = await computeWorkingTreeHash(dir);
    symlinkSync(join(dir, "a.txt"), join(dir, "a-link.txt"));
    const after = await computeWorkingTreeHash(dir);
    expect(after).not.toBe(before);
  });

  it("changes when a symlink's target changes, even though the symlink's own path is unchanged", async () => {
    const dir = freshFixtureTree();
    symlinkSync(join(dir, "a.txt"), join(dir, "a-link.txt"));
    const before = await computeWorkingTreeHash(dir);
    rmSync(join(dir, "a-link.txt"));
    symlinkSync(join(dir, "nested", "b.txt"), join(dir, "a-link.txt"));
    const after = await computeWorkingTreeHash(dir);
    expect(after).not.toBe(before);
  });

  it("never follows a symlink into a directory it points at (no double-counting/traversal)", async () => {
    const dir = freshFixtureTree();
    const outsideDir = freshTmpDir();
    dirs.push(outsideDir);
    writeFileSync(join(outsideDir, "outside.txt"), "should never be traversed into\n");
    symlinkSync(outsideDir, join(dir, "escape-link"));
    // Must not throw (e.g. from trying to `readFileSync` a directory as if
    // it were the symlink's own content) and must not pick up
    // "outside.txt" as one of ITS OWN entries.
    await expect(computeWorkingTreeHash(dir)).resolves.toEqual(expect.any(String));
  });
});

describe("withTreeInvariance (WI2 — the exported wrapper 08/23 reuse directly)", () => {
  it("returns the wrapped function's result when the tree is untouched", async () => {
    const dir = freshFixtureTree();
    const result = await withTreeInvariance(dir, () => 42);
    expect(result).toBe(42);
  });

  it("propagates TreeMutatedError when the wrapped function mutates the tree", async () => {
    const dir = freshFixtureTree();
    await expect(
      withTreeInvariance(dir, () => {
        writeFileSync(join(dir, "a.txt"), "mutated by the wrapped op\n");
      }),
    ).rejects.toBeInstanceOf(TreeMutatedError);
  });
});

/**
 * MINOR 5 fix (2026-07-18 adversarial validation round): `computeWorkingTreeHash`
 * alone is deliberately `.git`-blind, so it cannot detect a mutation of
 * `.git`'s own load-bearing state (HEAD/refs/config/index) — exactly why
 * MINOR 4 (freeze mutating the user checkout's `.git/index`) went
 * undetected even though this harness already existed. These tests prove
 * `computeGitStateHash`/`withUserCheckoutInvariance` close that gap.
 */
describe("computeGitStateHash / withUserCheckoutInvariance (MINOR 5 fix)", () => {
  function freshGitFixtureRepo(): string {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    return dir;
  }

  it("is deterministic: hashing an unchanged repo's .git state twice yields the same hash", async () => {
    const dir = freshGitFixtureRepo();
    const h1 = await computeGitStateHash(dir);
    const h2 = await computeGitStateHash(dir);
    expect(h1).toBe(h2);
  });

  it("changes when HEAD is repointed (a real ref mutation this harness must catch)", async () => {
    const dir = freshGitFixtureRepo();
    const before = await computeGitStateHash(dir);
    fixtureGit(dir, ["checkout", "-q", "-b", "other-branch"]);
    const after = await computeGitStateHash(dir);
    expect(after).not.toBe(before);
  });

  it("changes when .git/config is edited", async () => {
    const dir = freshGitFixtureRepo();
    const before = await computeGitStateHash(dir);
    fixtureGit(dir, ["config", "some.testkey", "testvalue"]);
    const after = await computeGitStateHash(dir);
    expect(after).not.toBe(before);
  });

  it("changes when .git/index bytes change (the exact MINOR 4 mutation this harness must detect)", async () => {
    const dir = freshGitFixtureRepo();
    const before = await computeGitStateHash(dir);
    const indexPath = join(dir, ".git", "index");
    const { appendFileSync } = await import("node:fs");
    // Directly mutate the index bytes (deterministic — not dependent on
    // whether a particular git command happens to trigger its own
    // racy-git stat-cache rewrite) to prove the harness is CAPABLE of
    // detecting an index mutation whenever one genuinely occurs.
    appendFileSync(indexPath, Buffer.from([0]));
    const after = await computeGitStateHash(dir);
    expect(after).not.toBe(before);
  });

  it("withUserCheckoutInvariance resolves cleanly when a wrapped operation touches nothing", async () => {
    const dir = freshGitFixtureRepo();
    const result = await withUserCheckoutInvariance(dir, () => "unchanged");
    expect(result).toBe("unchanged");
  });

  it("withUserCheckoutInvariance throws TreeMutatedError when a wrapped operation repoints HEAD (a .git-only mutation invisible to the working-tree-only harness)", async () => {
    const dir = freshGitFixtureRepo();
    await expect(
      withUserCheckoutInvariance(dir, () => {
        fixtureGit(dir, ["checkout", "-q", "-b", "sneaky-branch"]);
      }),
    ).rejects.toBeInstanceOf(TreeMutatedError);
  });
});

import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJournalStore, JournalEntrySchema } from "@eo/journal";
import { ensureControlClone, fetchRefresh } from "./control-clone.js";
import { freezeIntake } from "./intake-freeze.js";
import { withUserCheckoutInvariance } from "./invariance.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
} from "./test-support/fixture-repo.js";

/**
 * WI5 (intake-freeze half) — roadmap/07-git-control-repo-worktrees.md work
 * item 5: "Failing-test-first: freezing a dirty user checkout with an
 * intersecting planned write blocks with the exact offending paths named;
 * a disjoint dirty path never blocks."
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

async function setUpFrozenControlClone(): Promise<{ userCheckout: string; controlDir: string }> {
  const { dir: userCheckout } = buildBasicFixtureRepo();
  dirs.push(userCheckout);
  fixtureGit(userCheckout, ["checkout", "-q", "main"]);
  const cacheRoot = freshTmpDir();
  dirs.push(cacheRoot);
  const controlDir = join(cacheRoot, "git-control");
  await ensureControlClone(plumbing, { sourceRepoPath: userCheckout, controlDir });
  await fetchRefresh(plumbing, controlDir, "main");
  return { userCheckout, controlDir };
}

function freshJournalStore() {
  const journalDir = freshTmpDir();
  dirs.push(journalDir);
  return createJournalStore({ journalDir });
}

describe("freezeIntake (WI5)", () => {
  it("a disjoint dirty path never blocks the freeze", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    writeFileSync(join(userCheckout, "README.md"), "unrelated dirt\n");

    const result = await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: ["src/other-file.txt"],
    });

    expect(result.status).toBe("frozen");
  });

  it("an intersecting planned write blocks, naming the exact offending path", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    writeFileSync(join(userCheckout, "src", "a.txt"), "dirty edit\n");
    writeFileSync(
      join(userCheckout, "README.md"),
      "unrelated dirt — must stay untouched by the block\n",
    );

    const result = await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: ["src/a.txt", "src/other-file.txt"],
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.offendingPaths).toEqual(["src/a.txt"]);
      // The disjoint README.md dirt is real dirt too, but was never a
      // planned write path, so it must never appear as "offending."
      expect(result.offendingPaths).not.toContain("README.md");
    }
  });

  it("captures the exact base object id from the control clone's target ref", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    const expectedHead = fixtureGit(controlDir, ["rev-parse", "main"]).trim();

    const result = await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: [],
    });

    expect(result.freeze.baseObjectId).toBe(expectedHead);
    expect(result.freeze.baseObjectId).toHaveLength(40);
  });

  it("captures the porcelain-v2 dirty snapshot and repository-format report", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    writeFileSync(join(userCheckout, "untracked-new.txt"), "new\n");

    const result = await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: [],
    });

    expect(result.freeze.dirtySnapshot.untracked.map((e) => e.path)).toContain("untracked-new.txt");
    expect(result.freeze.repositoryFormat.objectFormat).toBe("sha1");
    expect(result.freeze.repositoryFormat.hasUnbornHead).toBe(false);
  });

  it("leaves unrelated dirt completely untouched on disk (freeze never mutates the user checkout)", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    writeFileSync(join(userCheckout, "src", "a.txt"), "blocked edit\n");
    writeFileSync(join(userCheckout, "README.md"), "unrelated dirt\n");

    await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: ["src/a.txt"],
    });

    const statusAfter = await plumbing.run(["status", "--porcelain=v2"], { cwd: userCheckout });
    expect(statusAfter.stdout).toContain("README.md");
    expect(statusAfter.stdout).toContain("src/a.txt");
  });

  it("journals a git_freeze entry that passes @eo/journal's own JournalEntrySchema", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    const store = freshJournalStore();

    await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: [],
      journal: store,
    });

    const entries = [];
    for await (const entry of store.queryEntries()) entries.push(entry);
    const freezeEntries = entries.filter((e) => e.type === "git_freeze");
    expect(freezeEntries).toHaveLength(1);
    expect(() => JournalEntrySchema.parse(freezeEntries[0])).not.toThrow();
  });

  /**
   * MINOR 4 fix (2026-07-18 adversarial validation round): `freezeIntake`
   * previously read the user checkout via a plain `git status`/`ls-files`,
   * which (git's own "racy git" stat-cache optimization) can rewrite
   * `.git/index` bytes as a side effect — a real mutation of the user's
   * checkout this package promises never to cause. Reproduced
   * deterministically here via `utimesSync` (a future mtime with unchanged
   * content is exactly the shape that triggers git's stat-cache refresh —
   * empirically confirmed against real git 2.43.0 during this fix's RED
   * phase; an ordinary content-only edit does not reliably trigger it on
   * every filesystem).
   *
   * MINOR 5 fix: wrapped in `withUserCheckoutInvariance` (not a raw byte
   * comparison) — proving the STRENGTHENED invariance harness (HEAD/refs/
   * config/index, not just the `.git`-blind working tree) now also
   * verifies this specific promise, closing the gap that let MINOR 4 go
   * undetected even though an invariance harness already existed.
   */
  it("MINOR 4/5 fix: freezing never mutates the user checkout's load-bearing .git state (index included), even under a racy-git stat-cache trigger", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    const trackedFile = join(userCheckout, "src", "a.txt");
    const future = new Date(Date.now() + 5000);
    utimesSync(trackedFile, future, future);

    const indexPath = join(userCheckout, ".git", "index");
    const beforeIndexBytes = readFileSync(indexPath);

    await withUserCheckoutInvariance(userCheckout, () =>
      freezeIntake({
        plumbing,
        controlDir,
        userCheckoutPath: userCheckout,
        targetRef: "main",
        plannedWritePaths: [],
      }),
    );

    const afterIndexBytes = readFileSync(indexPath);
    expect(afterIndexBytes.equals(beforeIndexBytes)).toBe(true);
  });

  it("journals a git_freeze entry naming the block when the freeze is blocked", async () => {
    const { userCheckout, controlDir } = await setUpFrozenControlClone();
    writeFileSync(join(userCheckout, "src", "a.txt"), "dirty\n");
    const store = freshJournalStore();

    await freezeIntake({
      plumbing,
      controlDir,
      userCheckoutPath: userCheckout,
      targetRef: "main",
      plannedWritePaths: ["src/a.txt"],
      journal: store,
    });

    const entries = [];
    for await (const entry of store.queryEntries()) entries.push(entry);
    const freezeEntry = entries.find((e) => e.type === "git_freeze");
    expect(freezeEntry).toBeDefined();
    if (freezeEntry?.type === "git_freeze") {
      expect(freezeEntry.payload.reason).toContain("src/a.txt");
      expect(freezeEntry.payload.reason.toLowerCase()).toContain("block");
    }
  });
});

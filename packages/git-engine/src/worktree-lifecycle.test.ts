import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJournalStore } from "@eo/journal";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
} from "./test-support/fixture-repo.js";
import {
  createWorktree,
  destroyWorktree,
  quarantineWorktree,
  sweepOrphanWorktrees,
} from "./worktree-lifecycle.js";

/**
 * WI6 — roadmap/07-git-control-repo-worktrees.md work item 6. This file
 * covers the "ordinary path" (create/destroy/quarantine, ref-collision
 * resistance across concurrent attempts). The crash-recovery RED test
 * ("kill -9 mid-worktree-creation") lives in
 * `./worktree-lifecycle.crash.test.ts`, reusing 04's `runKillHarness`
 * directly per this phase's brief.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

interface Rig {
  readonly repoDir: string;
  readonly headObjectId: string;
  readonly worktreesRootDir: string;
  readonly quarantineDir: string;
}

function setUpRig(): Rig {
  const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
  dirs.push(repoDir);
  const cacheRoot = freshTmpDir();
  dirs.push(cacheRoot);
  return {
    repoDir,
    headObjectId,
    worktreesRootDir: join(cacheRoot, "worktrees"),
    quarantineDir: join(cacheRoot, "worktree-quarantine"),
  };
}

describe("createWorktree (WI6)", () => {
  it("creates a real worktree checked out at the given base object id", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });

    expect(existsSync(join(record.worktreePath, "README.md"))).toBe(true);
    expect(record.ref).toBe(`work/run1/cs1/task1/${record.attempt}`);
    const head = fixtureGit(record.worktreePath, ["rev-parse", "HEAD"]).trim();
    expect(head).toBe(rig.headObjectId);
  });

  it("configures the neutral git identity automatically at creation time (WI8 integration)", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });

    writeFileSync(join(record.worktreePath, "worker-output.txt"), "work\n");
    fixtureGit(record.worktreePath, ["add", "-A"]);
    fixtureGit(record.worktreePath, ["commit", "-q", "-m", "worker commit", "--no-verify"]);
    const authorName = fixtureGit(record.worktreePath, ["log", "-1", "--format=%an"]).trim();
    const authorEmail = fixtureGit(record.worktreePath, ["log", "-1", "--format=%ae"]).trim();
    expect(authorName).toBe("Engineering Orchestrator");
    expect(authorEmail).toBe("svc@example.invalid");
  });

  it("ref-collision resistance: many concurrent attempts on the SAME task never collide", async () => {
    const rig = setUpRig();
    const records = await Promise.all(
      Array.from({ length: 12 }, () =>
        createWorktree(plumbing, {
          repoDir: rig.repoDir,
          worktreesRootDir: rig.worktreesRootDir,
          runId: "run1",
          changeSetId: "cs1",
          taskId: "same-task",
          baseObjectId: rig.headObjectId,
          serviceEmail: "svc@example.invalid",
        }),
      ),
    );
    const refs = new Set(records.map((r) => r.ref));
    const paths = new Set(records.map((r) => r.worktreePath));
    expect(refs.size).toBe(12);
    expect(paths.size).toBe(12);
  });

  it("rejects a path-escape attempt at the worktree boundary (../ segment)", async () => {
    const rig = setUpRig();
    await expect(
      createWorktree(plumbing, {
        repoDir: rig.repoDir,
        worktreesRootDir: rig.worktreesRootDir,
        runId: "..",
        changeSetId: "cs1",
        taskId: "task1",
        baseObjectId: rig.headObjectId,
        serviceEmail: "svc@example.invalid",
      }),
    ).rejects.toThrow();
  });
});

describe("destroyWorktree (WI6)", () => {
  it("removes a clean worktree entirely", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });

    await destroyWorktree(plumbing, rig.repoDir, record.worktreePath);

    expect(existsSync(record.worktreePath)).toBe(false);
  });
});

describe("quarantineWorktree (WI6)", () => {
  it("moves a dirty worktree to the quarantine dir and journals a worktree_quarantine entry", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });
    writeFileSync(join(record.worktreePath, "uncommitted.txt"), "dirty work\n");

    const journalDir = freshTmpDir();
    dirs.push(journalDir);
    const store = createJournalStore({ journalDir });

    const result = await quarantineWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreePath: record.worktreePath,
      quarantineDir: rig.quarantineDir,
      reason: "dirty worktree found after worker exit",
      journal: store,
    });

    expect(existsSync(record.worktreePath)).toBe(false);
    expect(existsSync(result.quarantinedPath)).toBe(true);
    expect(existsSync(join(result.quarantinedPath, "uncommitted.txt"))).toBe(true);

    const entries = [];
    for await (const entry of store.queryEntries()) entries.push(entry);
    const quarantineEntries = entries.filter((e) => e.type === "worktree_quarantine");
    expect(quarantineEntries).toHaveLength(1);
    if (quarantineEntries[0]?.type === "worktree_quarantine") {
      expect(quarantineEntries[0].payload.reason).toContain("dirty worktree");
    }
  });

  it("quarantine is never silently identical to deletion — the working tree content survives the move", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });
    writeFileSync(join(record.worktreePath, "valuable-work.txt"), "do not lose me\n");

    const result = await quarantineWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreePath: record.worktreePath,
      quarantineDir: rig.quarantineDir,
      reason: "test",
    });

    const content = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(result.quarantinedPath, "valuable-work.txt"), "utf8"),
    );
    expect(content).toBe("do not lose me\n");
  });
});

describe("sweepOrphanWorktrees (WI6 — ordinary path; crash path in ./worktree-lifecycle.crash.test.ts)", () => {
  it("a clean, fully-created worktree is left alone (reported completed, not quarantined)", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });

    const report = await sweepOrphanWorktrees(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      quarantineDir: rig.quarantineDir,
    });

    expect(report.completed).toContain(record.worktreePath);
    expect(report.quarantined).toEqual([]);
  });

  it("a dirty worktree found at sweep time is quarantined, never silently left or cleaned", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });
    writeFileSync(join(record.worktreePath, "left-dirty.txt"), "oops\n");

    const report = await sweepOrphanWorktrees(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      quarantineDir: rig.quarantineDir,
    });

    expect(report.quarantined).toHaveLength(1);
    expect(existsSync(record.worktreePath)).toBe(false);
  });

  it("pass 2 skips a non-directory entry sitting directly in the quarantine dir", async () => {
    const rig = setUpRig();
    const { mkdirSync, writeFileSync: writeFile } = await import("node:fs");
    mkdirSync(rig.quarantineDir, { recursive: true });
    writeFile(join(rig.quarantineDir, "stray-file.txt"), "not a worktree dir\n");

    await expect(
      sweepOrphanWorktrees(plumbing, {
        repoDir: rig.repoDir,
        worktreesRootDir: rig.worktreesRootDir,
        quarantineDir: rig.quarantineDir,
        journal: createJournalStore({ journalDir: freshTmpDir() }),
      }),
    ).resolves.toBeDefined();
  });

  it("pass 2 skips an already-quarantined directory that has no marker file (nothing to reconcile)", async () => {
    const rig = setUpRig();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(rig.quarantineDir, "no-marker-here"), { recursive: true });
    const journalDir = freshTmpDir();
    dirs.push(journalDir);
    const store = createJournalStore({ journalDir });

    await sweepOrphanWorktrees(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      quarantineDir: rig.quarantineDir,
      journal: store,
    });

    const entries = [];
    for await (const entry of store.queryEntries()) entries.push(entry);
    expect(entries).toEqual([]);
  });

  it("MINOR 6 fix: N repeated sweeps over one persistent quarantine dir yield exactly ONE journal entry total", async () => {
    const rig = setUpRig();
    const record = await createWorktree(plumbing, {
      repoDir: rig.repoDir,
      worktreesRootDir: rig.worktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: rig.headObjectId,
      serviceEmail: "svc@example.invalid",
    });
    writeFileSync(join(record.worktreePath, "left-dirty.txt"), "oops\n");

    const journalDir = freshTmpDir();
    dirs.push(journalDir);
    const store = createJournalStore({ journalDir });

    // First sweep discovers the dirty worktree and quarantines it (pass 1
    // journals once). Repeat the sweep several more times over the SAME
    // persistent quarantine dir — previously, pass 2 re-journaled the
    // already-quarantined dir on EVERY subsequent sweep call.
    for (let i = 0; i < 5; i++) {
      await sweepOrphanWorktrees(plumbing, {
        repoDir: rig.repoDir,
        worktreesRootDir: rig.worktreesRootDir,
        quarantineDir: rig.quarantineDir,
        journal: store,
      });
    }

    const entries = [];
    for await (const entry of store.queryEntries()) entries.push(entry);
    const quarantineEntries = entries.filter((e) => e.type === "worktree_quarantine");
    expect(quarantineEntries).toHaveLength(1);
  });

  it("NOTE 7 fix: a symlinked worktreesRootDir still recognizes ownership of a registered worktree (realpath-normalized comparison)", async () => {
    const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const realWorktreesRootDir = join(cacheRoot, "real-worktrees");
    const quarantineDir = join(cacheRoot, "worktree-quarantine");

    const record = await createWorktree(plumbing, {
      repoDir,
      worktreesRootDir: realWorktreesRootDir,
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: headObjectId,
      serviceEmail: "svc@example.invalid",
    });
    writeFileSync(join(record.worktreePath, "left-dirty.txt"), "oops\n");

    const { symlinkSync } = await import("node:fs");
    const symlinkedWorktreesRootDir = join(cacheRoot, "worktrees-symlink");
    symlinkSync(realWorktreesRootDir, symlinkedWorktreesRootDir);

    // Sweep using the SYMLINK path, not the real path — the registered
    // worktree's own path (as git reports it) is the REAL path, so a naive
    // textual prefix check against the symlink would find no match and
    // silently skip this genuine orphan.
    const report = await sweepOrphanWorktrees(plumbing, {
      repoDir,
      worktreesRootDir: symlinkedWorktreesRootDir,
      quarantineDir,
    });

    expect(report.quarantined).toHaveLength(1);
    expect(existsSync(record.worktreePath)).toBe(false);
  });
});

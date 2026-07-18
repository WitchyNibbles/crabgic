import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createJournalStore, runKillHarness } from "@eo/journal";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { createWorktree, isWorktreeDirty, sweepOrphanWorktrees } from "./worktree-lifecycle.js";
import {
  buildBasicFixtureRepo,
  freshTmpDir,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * WI6 — roadmap/07-git-control-repo-worktrees.md work item 6: "Failing-
 * test-first (reuse 04 `runKillHarness`): kill -9 mid-worktree-creation,
 * next startup must complete OR quarantine it — never silently drop it."
 * Also covers the Test plan's "kill -9 mid-quarantine" crash case. Reuses
 * `@eo/journal`'s `runKillHarness` DIRECTLY (not forked/re-implemented),
 * per this phase's brief. Fixture entry scripts live in
 * `./crash-fixtures/*.mjs` and import THIS package's own real, built
 * `dist` (see `./crash-fixtures/worktree-create-steps.mjs`'s doc comment).
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "crash-fixtures");
const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

describe("kill -9 mid-worktree-creation (WI6 RED requirement)", () => {
  it("every fault point converges to either a fully-completed OR a quarantined worktree — never a silently-dropped one", async () => {
    const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const worktreesRootDir = join(cacheRoot, "worktrees");
    const quarantineDir = join(cacheRoot, "worktree-quarantine");

    const faultPoints = [
      "before-worktree-add",
      "after-worktree-add-before-identity",
      "after-identity-before-marker",
      "done",
    ];

    const report = await runKillHarness(
      (ctx) => ({
        command: process.execPath,
        args: [
          join(FIXTURES_DIR, "worktree-create-steps.mjs"),
          repoDir,
          worktreesRootDir,
          "run1",
          "cs1",
          "task1",
          `att-fixed-${ctx.attemptIndex}`,
          headObjectId,
          "svc-eo@example.invalid",
        ],
      }),
      faultPoints,
      {
        verify: async (ctx) => {
          const worktreePath = join(
            worktreesRootDir,
            "run1",
            "cs1",
            "task1",
            `att-fixed-${ctx.attemptIndex}`,
          );
          await sweepOrphanWorktrees(plumbing, { repoDir, worktreesRootDir, quarantineDir });

          const stillAtOriginal = existsSync(worktreePath);
          if (stillAtOriginal) {
            // Must be genuinely complete, not just "not yet swept": git
            // recognizes it as a real worktree, it's clean, AND it carries
            // the same completion marker `createWorktree`/`sweepOrphanWorktrees`
            // themselves use to decide completeness (checked directly here,
            // in git's own per-worktree admin dir — NOT the working tree —
            // matching worktree-lifecycle.ts's own `hasCompletionMarker`).
            // A worktree stopped between "worktree add" and "identity
            // config" would otherwise look deceptively "clean" to a
            // naive dirty-only check while still missing its identity.
            const revParse = await plumbing.run(["rev-parse", "--git-dir"], {
              cwd: worktreePath,
              allowFailure: true,
            });
            const gitDirOk = revParse.exitCode === 0;
            const dirty = gitDirOk ? await isWorktreeDirty(plumbing, worktreePath) : true;
            let hasMarker = false;
            if (gitDirOk) {
              const raw = revParse.stdout.trim();
              const adminDir = raw.startsWith("/") ? raw : join(worktreePath, raw);
              hasMarker = existsSync(join(adminDir, "eo-worktree-complete"));
            }
            return {
              recovered: gitDirOk && !dirty && hasMarker,
              detail: `left at original path; git-dir ok=${gitDirOk}, dirty=${dirty}, hasMarker=${hasMarker}`,
            };
          }
          // Not at the original path. Two legitimate outcomes: (a) it was
          // quarantined (moved, with a trace left behind), or (b) the
          // operation was killed before `git worktree add` ever ran at
          // all — nothing was ever created, so there is nothing to
          // "silently drop" in the first place (a clean "never started,"
          // exactly like an ordinary failed attempt a caller retries with
          // a fresh attempt token). Anything OTHER than these two — a
          // registered-but-abandoned worktree with no trace anywhere —
          // would be the real failure this test exists to catch.
          const quarantineHasSomething =
            existsSync(quarantineDir) && readdirSync(quarantineDir).length > 0;
          if (quarantineHasSomething) {
            return { recovered: true, detail: "moved out of worktreesRootDir; quarantined" };
          }
          const refCheck = await plumbing.run(
            ["rev-parse", "--verify", "-q", `work/run1/cs1/task1/att-fixed-${ctx.attemptIndex}`],
            { cwd: repoDir, allowFailure: true },
          );
          const neverStarted = refCheck.exitCode !== 0;
          return {
            recovered: neverStarted,
            detail: `no trace at worktreesRootDir or quarantineDir; ref never created=${neverStarted}`,
          };
        },
        spawnTimeoutMs: 10_000,
      },
    );

    expect(
      report.results.filter((r) => r.verdict === "fail"),
      JSON.stringify(report.results, null, 2),
    ).toHaveLength(0);
    expect(report.allConverged).toBe(true);
  }, 60_000);
});

describe("kill -9 mid-quarantine (WI6 Test plan crash case)", () => {
  it("every fault point converges: the worktree ends up EITHER back at its original path (never attempted) OR fully quarantined with its journal entry eventually recorded — never lost", async () => {
    const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const worktreesRootDir = join(cacheRoot, "worktrees");
    const quarantineDir = join(cacheRoot, "worktree-quarantine");
    const journalDir = freshTmpDir();
    dirs.push(journalDir);

    const faultPoints = ["before-quarantine-move", "after-marker-before-journal", "done"];

    // Each fault point gets its OWN isolated worktreesRootDir/quarantineDir
    // pair (never a shared one) — `sweepOrphanWorktrees` scans EVERY
    // registered worktree under its given root, so sharing one root across
    // iterations would let iteration N's verify() sweep (and prematurely
    // quarantine) iteration N+1's not-yet-crash-tested worktree.
    const worktreePaths: string[] = [];
    const perAttemptWorktreesRootDir: string[] = [];
    const perAttemptQuarantineDir: string[] = [];
    for (let i = 0; i < faultPoints.length; i++) {
      const attemptWorktreesRootDir = join(worktreesRootDir, `attempt-${i}`);
      const attemptQuarantineDir = join(quarantineDir, `attempt-${i}`);
      const record = await createWorktree(plumbing, {
        repoDir,
        worktreesRootDir: attemptWorktreesRootDir,
        runId: "run1",
        changeSetId: "cs1",
        taskId: "task",
        baseObjectId: headObjectId,
        serviceEmail: "svc-eo@example.invalid",
      });
      writeFixtureFile(record.worktreePath, "dirty.txt", "dirty work\n");
      worktreePaths.push(record.worktreePath);
      perAttemptWorktreesRootDir.push(attemptWorktreesRootDir);
      perAttemptQuarantineDir.push(attemptQuarantineDir);
    }

    const report = await runKillHarness(
      (ctx) => ({
        command: process.execPath,
        args: [
          join(FIXTURES_DIR, "quarantine-steps.mjs"),
          repoDir,
          worktreePaths[ctx.attemptIndex]!,
          perAttemptQuarantineDir[ctx.attemptIndex]!,
          journalDir,
          `crash-test quarantine attempt ${ctx.attemptIndex}`,
        ],
      }),
      faultPoints,
      {
        verify: async (ctx) => {
          const attemptWorktreesRootDir = perAttemptWorktreesRootDir[ctx.attemptIndex]!;
          const attemptQuarantineDir = perAttemptQuarantineDir[ctx.attemptIndex]!;
          const store = createJournalStore({ journalDir });
          await sweepOrphanWorktrees(plumbing, {
            repoDir,
            worktreesRootDir: attemptWorktreesRootDir,
            quarantineDir: attemptQuarantineDir,
            journal: store,
          });

          const entries = [];
          for await (const entry of store.queryEntries()) entries.push(entry);
          const quarantineEntries = entries.filter((e) => e.type === "worktree_quarantine");

          // Recovered iff this attempt's quarantine dir has an entry AND
          // that entry has a corresponding journal record (no
          // silently-orphaned quarantine).
          const quarantinedDirs = existsSync(attemptQuarantineDir)
            ? readdirSync(attemptQuarantineDir)
            : [];
          const journaledPaths = new Set(
            quarantineEntries
              .map((e) => (e.type === "worktree_quarantine" ? e.payload.worktreePath : undefined))
              .filter((p): p is string => p !== undefined),
          );
          const recovered =
            quarantinedDirs.length > 0 &&
            quarantinedDirs.every((name) => [...journaledPaths].some((p) => p.endsWith(name)));
          return {
            recovered,
            detail: `quarantinedDirs=${JSON.stringify(quarantinedDirs)}, journaledPaths=${JSON.stringify([...journaledPaths])}`,
          };
        },
        spawnTimeoutMs: 10_000,
      },
    );

    expect(
      report.results.filter((r) => r.verdict === "fail"),
      JSON.stringify(report.results, null, 2),
    ).toHaveLength(0);
    expect(report.allConverged).toBe(true);
  }, 60_000);
});

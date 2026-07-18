import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runKillHarness } from "@eo/journal";
import { ensureControlClone } from "./control-clone.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { buildBasicFixtureRepo, freshTmpDir, removeDirTree } from "./test-support/fixture-repo.js";

/**
 * WI5 — roadmap/07-git-control-repo-worktrees.md Test plan: "crash tests
 * reusing 04's kill harness (kill -9 mid-clone ... each must recover
 * deterministically on next startup)." Reuses `@eo/journal`'s
 * `runKillHarness` directly. Recovery for the control clone is simple by
 * design: it is disposable cache (never shares state with the user's
 * checkout), so "recover" means "the next `ensureControlClone` call for
 * the same `controlDir` either finds a complete, usable clone or safely
 * redoes it" — never a half-cloned directory silently treated as usable.
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "crash-fixtures");
const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

/** Recovery policy for a possibly-interrupted control clone: if `.git` is missing or `HEAD` doesn't resolve to a real commit, wipe and re-clone from scratch (safe — the control clone is disposable cache, never touches the user's checkout). Otherwise it's already usable. */
async function recoverControlClone(sourceRepoPath: string, controlDir: string): Promise<boolean> {
  const gitDirOk = existsSync(join(controlDir, ".git"));
  if (gitDirOk) {
    const headCheck = await plumbing.run(["rev-parse", "-q", "--verify", "HEAD"], {
      cwd: controlDir,
      allowFailure: true,
    });
    if (headCheck.exitCode === 0) return true; // already a usable, complete clone
  }
  const { rm } = await import("node:fs/promises");
  await rm(controlDir, { recursive: true, force: true });
  await ensureControlClone(plumbing, { sourceRepoPath, controlDir });
  return existsSync(join(controlDir, ".git"));
}

describe("kill -9 mid-clone (WI5 Test plan crash case)", () => {
  it("every fault point recovers deterministically on the next call — never a silently-half-cloned control dir", async () => {
    const { dir: sourceRepoPath } = buildBasicFixtureRepo();
    dirs.push(sourceRepoPath);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);

    const faultPoints = [
      "before-clone",
      "after-clone-before-hooks-neutralize",
      "after-hooks-neutralize-before-done",
    ];

    const report = await runKillHarness(
      (ctx) => ({
        command: process.execPath,
        args: [
          join(FIXTURES_DIR, "clone-steps.mjs"),
          sourceRepoPath,
          join(cacheRoot, `git-control-${ctx.attemptIndex}`),
        ],
      }),
      faultPoints,
      {
        verify: async (ctx) => {
          const controlDir = join(cacheRoot, `git-control-${ctx.attemptIndex}`);
          const recovered = await recoverControlClone(sourceRepoPath, controlDir);
          return { recovered };
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

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureControlClone } from "./control-clone.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { createWorktree, isWorktreeDirty } from "./worktree-lifecycle.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * MAJOR 2 (2026-07-18 adversarial validation round) — HOOKS/FILTERS NOT
 * NEUTRALIZED IN CONTROL CONTEXT. `repo-validation.ts`'s
 * `neutralizeHooksPath` only sets repo-LOCAL `core.hooksPath`, and only
 * AFTER `ensureControlClone`'s own clone step — so an AMBIENT global/system
 * `core.hooksPath` fires during the clone's own initial checkout, and an
 * ambient `filter.<x>.smudge` (e.g. `git-lfs install`'s global filter
 * registration) is NEVER neutralized at all, firing during both clone and
 * `createWorktree`'s `worktree add`.
 *
 * This suite simulates "ambient" global config the same way a real user's
 * `~/.gitconfig` would supply it — by pointing `GIT_CONFIG_GLOBAL` (an
 * env var git itself honors as an override for which file IS its global
 * config, present since git 2.32) at a fixture file for the duration of
 * one spawn — then proves the fix (`CONTROL_CONTEXT_ENV`, forcing
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM=/dev/null` on every control-context
 * spawn) makes neither the hook nor the filter fire, regardless of what an
 * ambient global config declares.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

interface AmbientConfigFixture {
  readonly globalConfigPath: string;
  readonly hookMarkerPath: string;
  readonly smudgeMarkerPath: string;
  readonly cleanMarkerPath: string;
}

/** Builds a fixture "ambient global config" declaring a `post-checkout` hook AND a `filter.eo-test-filter` with both a `smudge` (fires on checkout) and a `clean` (fires when `git status` re-hashes a stat-mismatched working-tree file), each writing a distinguishable marker file when it fires. Also builds a source repo that both a plain `.gitattributes` (`* filter=eo-test-filter`) and the hook-firing checkout step can exercise. */
function buildAmbientConfigFixture(sandbox: string): AmbientConfigFixture {
  const hooksDir = join(sandbox, "ambient-hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookMarkerPath = join(sandbox, "hook-fired.marker");
  const hookScript = join(hooksDir, "post-checkout");
  writeFileSync(hookScript, `#!/bin/sh\ntouch "${hookMarkerPath}"\n`, "utf8");
  chmodSync(hookScript, 0o755);

  const smudgeMarkerPath = join(sandbox, "smudge-fired.marker");
  const cleanMarkerPath = join(sandbox, "clean-fired.marker");
  const globalConfigPath = join(sandbox, "ambient-gitconfig");
  writeFileSync(
    globalConfigPath,
    [
      "[core]",
      `\thooksPath = ${hooksDir}`,
      '[filter "eo-test-filter"]',
      `\tsmudge = touch ${smudgeMarkerPath}; cat`,
      `\tclean = touch ${cleanMarkerPath}; cat`,
      "\trequired = true",
      "",
    ].join("\n"),
    "utf8",
  );

  return { globalConfigPath, hookMarkerPath, smudgeMarkerPath, cleanMarkerPath };
}

function buildLfsAttributedSourceRepo(): { readonly dir: string; readonly headObjectId: string } {
  const { dir } = buildBasicFixtureRepo();
  fixtureGit(dir, ["checkout", "-q", "main"]);
  writeFixtureFile(dir, ".gitattributes", "* filter=eo-test-filter\n");
  writeFixtureFile(dir, "assets/tracked.bin", "some tracked content\n");
  fixtureGit(dir, ["add", "-A"]);
  fixtureGit(dir, ["commit", "-q", "-m", "add .gitattributes", "--no-verify"]);
  const newHead = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, headObjectId: newHead };
}

describe("MAJOR 2 fix — control-context operations neutralize ambient global hooks/filters", () => {
  it("ensureControlClone: neither the ambient post-checkout hook nor the ambient smudge filter fires during clone", async () => {
    const sandbox = freshTmpDir();
    dirs.push(sandbox);
    const { globalConfigPath, hookMarkerPath, smudgeMarkerPath } =
      buildAmbientConfigFixture(sandbox);
    const { dir: sourceDir } = buildLfsAttributedSourceRepo();
    dirs.push(sourceDir);
    const controlDir = join(sandbox, "git-control");

    const originalAmbientGlobal = process.env["GIT_CONFIG_GLOBAL"];
    process.env["GIT_CONFIG_GLOBAL"] = globalConfigPath;
    try {
      expect(existsSync(hookMarkerPath)).toBe(false);
      expect(existsSync(smudgeMarkerPath)).toBe(false);

      await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

      expect(existsSync(hookMarkerPath)).toBe(false);
      expect(existsSync(smudgeMarkerPath)).toBe(false);
      expect(existsSync(join(controlDir, ".git"))).toBe(true);
    } finally {
      if (originalAmbientGlobal === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
      else process.env["GIT_CONFIG_GLOBAL"] = originalAmbientGlobal;
    }
  });

  it("createWorktree: neither the ambient post-checkout hook nor the ambient smudge filter fires during `worktree add`", async () => {
    const sandbox = freshTmpDir();
    dirs.push(sandbox);
    const { globalConfigPath, hookMarkerPath, smudgeMarkerPath } =
      buildAmbientConfigFixture(sandbox);
    const { dir: repoDir, headObjectId } = buildLfsAttributedSourceRepo();
    dirs.push(repoDir);

    const originalAmbientGlobal = process.env["GIT_CONFIG_GLOBAL"];
    process.env["GIT_CONFIG_GLOBAL"] = globalConfigPath;
    try {
      expect(existsSync(hookMarkerPath)).toBe(false);
      expect(existsSync(smudgeMarkerPath)).toBe(false);

      const record = await createWorktree(plumbing, {
        repoDir,
        worktreesRootDir: join(sandbox, "worktrees"),
        runId: "run1",
        changeSetId: "cs1",
        taskId: "task1",
        baseObjectId: headObjectId,
        serviceEmail: "svc@example.invalid",
      });

      expect(existsSync(hookMarkerPath)).toBe(false);
      expect(existsSync(smudgeMarkerPath)).toBe(false);
      expect(existsSync(join(record.worktreePath, "assets", "tracked.bin"))).toBe(true);
    } finally {
      if (originalAmbientGlobal === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
      else process.env["GIT_CONFIG_GLOBAL"] = originalAmbientGlobal;
    }
  });

  // Residual of MAJOR 2 caught by the 2026-07-18 fix re-audit: the initial fix
  // enveloped clone/fetch/rev-parse/worktree-add but MISSED `isWorktreeDirty`'s
  // `git status`, which `sweepOrphanWorktrees` runs on every registered control
  // worktree at startup — so an ambient `clean`/`process` filter (e.g. git-lfs)
  // would still execute in the control context during the crash-orphan sweep.
  it("isWorktreeDirty: the ambient clean filter never fires when scanning a control worktree for dirt", async () => {
    const sandbox = freshTmpDir();
    dirs.push(sandbox);
    const { globalConfigPath, cleanMarkerPath } = buildAmbientConfigFixture(sandbox);
    const { dir: repoDir, headObjectId } = buildLfsAttributedSourceRepo();
    dirs.push(repoDir);

    const record = await createWorktree(plumbing, {
      repoDir,
      worktreesRootDir: join(sandbox, "worktrees"),
      runId: "run1",
      changeSetId: "cs1",
      taskId: "task1",
      baseObjectId: headObjectId,
      serviceEmail: "svc@example.invalid",
    });

    // A worker edits a filter-attributed file, creating the stat mismatch that
    // makes `git status` re-hash the working-tree content (and thus run the
    // ambient `clean` filter, if ambient config is honored).
    writeFileSync(
      join(record.worktreePath, "assets", "tracked.bin"),
      "edited by a worker\n",
      "utf8",
    );

    const originalAmbientGlobal = process.env["GIT_CONFIG_GLOBAL"];
    process.env["GIT_CONFIG_GLOBAL"] = globalConfigPath;
    try {
      expect(existsSync(cleanMarkerPath)).toBe(false);
      const dirty = await isWorktreeDirty(plumbing, record.worktreePath);
      expect(dirty).toBe(true); // the edit is genuinely detected
      // ...but the ambient clean filter must NOT have run in the control context.
      expect(existsSync(cleanMarkerPath)).toBe(false);
    } finally {
      if (originalAmbientGlobal === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
      else process.env["GIT_CONFIG_GLOBAL"] = originalAmbientGlobal;
    }
  });
});

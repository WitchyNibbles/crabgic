import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchRefresh, ensureControlClone } from "./control-clone.js";
import { detectRenamesFromWorktree } from "./overlap-analyzer.js";
import { freezeIntake } from "./intake-freeze.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { createWorktree } from "./worktree-lifecycle.js";
import { InvalidObjectIdError, UnsafeGitRefError } from "./git-arg-guard.js";
import { buildBasicFixtureRepo, freshTmpDir, removeDirTree } from "./test-support/fixture-repo.js";

/**
 * CRITICAL 1 (2026-07-18 adversarial validation round) — ARGUMENT
 * INJECTION / OPTION SMUGGLING regression suite. `plumbing.ts`'s argv-array
 * + `shell:false` invocation defeats SHELL injection, but no call site
 * previously inserted an option-terminator before a caller-influenced
 * POSITIONAL, so `git` itself parsed a leading-dash value as a FLAG. This
 * file reproduces the validator's exact two PROVEN exploits — (a) RCE via
 * `git fetch origin <ref>` with a `--upload-pack=` ref, (b) arbitrary file
 * overwrite via `git diff ... <baseRef> <headRef>` with a `--output=` ref —
 * plus regression coverage for the other named-vulnerable call sites
 * (clone's source positional, worktree-add's baseObjectId, intake-freeze's
 * targetRef, fetch's ref).
 *
 * SANDBOXING: every exploit reproduction below runs entirely inside a fresh
 * `fs.mkdtempSync(os.tmpdir())` directory, cleaned up in `afterEach` — the
 * RCE marker file and the overwrite victim file are BOTH created inside
 * that sandbox, never touching the real repo or $HOME, per this fix's own
 * sandboxing requirement.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

function sandboxDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-argv-injection-sandbox-"));
  dirs.push(dir);
  return dir;
}

describe("CRITICAL 1 fix — fetch RCE via --upload-pack option smuggling is blocked", () => {
  it("a ref shaped like --upload-pack=<cmd> never executes the smuggled command (RCE contained to a tmp sandbox)", async () => {
    const sandbox = sandboxDir();
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const controlDir = join(sandbox, "git-control");
    await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    const marker = join(sandbox, "rce-marker");
    expect(existsSync(marker)).toBe(false);
    const maliciousRef = `--upload-pack=touch ${marker};git-upload-pack`;
    // The exploit deliberately chains `;git-upload-pack` after the
    // injected `touch` so the underlying fetch still "succeeds" — the
    // security property under test is the marker's absence, NOT whether
    // this call throws (on unfixed code it does not throw; on fixed code
    // it throws `UnsafeGitRefError` before ever spawning git — either way,
    // the marker must never exist).
    await fetchRefresh(plumbing, controlDir, maliciousRef).catch(() => undefined);

    // The core security assertion: the smuggled `touch` command never ran.
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects a leading-dash fetch ref up front with a typed error, before ever spawning git", async () => {
    const sandbox = sandboxDir();
    const { dir: sourceDir } = buildBasicFixtureRepo();
    dirs.push(sourceDir);
    const controlDir = join(sandbox, "git-control");
    await ensureControlClone(plumbing, { sourceRepoPath: sourceDir, controlDir });

    await expect(fetchRefresh(plumbing, controlDir, "-badref")).rejects.toBeInstanceOf(
      UnsafeGitRefError,
    );
  });
});

describe("CRITICAL 1 fix — overlap-analyzer diff --output overwrite is blocked", () => {
  it("a baseRef shaped like --output=<victim> never truncates/overwrites the victim file (contained to a tmp sandbox)", async () => {
    const sandbox = sandboxDir();
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const headRef = "HEAD";

    const victim = join(sandbox, "victim.txt");
    const preciousContent = "PRECIOUS DATA - MUST NOT BE OVERWRITTEN\n";
    writeFileSync(victim, preciousContent, "utf8");

    const maliciousBaseRef = `--output=${victim}`;

    // `--output=<file>` is a legitimate `git diff` flag (redirects diff
    // output to a file) — misapplied via a smuggled positional it makes the
    // call "succeed" (exit 0) while truncating/overwriting the victim file.
    // The security property under test is the victim's content, NOT
    // whether this call throws.
    await detectRenamesFromWorktree(plumbing, dir, maliciousBaseRef, headRef).catch(
      () => undefined,
    );

    // The core security assertion: the victim file, OUTSIDE the repo, was
    // never touched.
    expect(readFileSync(victim, "utf8")).toBe(preciousContent);
  });
});

describe("CRITICAL 1 fix — control-clone's clone source positional is inert to option smuggling", () => {
  it("a sourceRepoPath shaped like a flag is never interpreted as one (fails as a literal bad repository, not a parsed flag)", async () => {
    const sandbox = sandboxDir();
    const controlDir = join(sandbox, "git-control");
    const marker = join(sandbox, "clone-rce-marker");

    await expect(
      ensureControlClone(plumbing, {
        sourceRepoPath: `--upload-pack=touch ${marker};git-upload-pack`,
        controlDir,
      }),
    ).rejects.toThrow();

    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(controlDir, ".git"))).toBe(false);
  });
});

describe("CRITICAL 1 fix — worktree-lifecycle rejects a non-hex baseObjectId", () => {
  it("rejects a flag-shaped baseObjectId with a typed error, before ever spawning `git worktree add`", async () => {
    const { dir: repoDir } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);

    await expect(
      createWorktree(plumbing, {
        repoDir,
        worktreesRootDir: join(cacheRoot, "worktrees"),
        runId: "run1",
        changeSetId: "cs1",
        taskId: "task1",
        baseObjectId: "-Bmain",
        serviceEmail: "svc@example.invalid",
      }),
    ).rejects.toBeInstanceOf(InvalidObjectIdError);
  });

  it("rejects a well-formed-length-but-non-hex baseObjectId too", async () => {
    const { dir: repoDir } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);

    await expect(
      createWorktree(plumbing, {
        repoDir,
        worktreesRootDir: join(cacheRoot, "worktrees"),
        runId: "run1",
        changeSetId: "cs1",
        taskId: "task1",
        baseObjectId: "z".repeat(40),
        serviceEmail: "svc@example.invalid",
      }),
    ).rejects.toBeInstanceOf(InvalidObjectIdError);
  });
});

describe("CRITICAL 1 fix — intake-freeze rejects a leading-dash targetRef", () => {
  it("rejects a flag-shaped targetRef up front with a typed error", async () => {
    const { dir: userCheckout } = buildBasicFixtureRepo();
    dirs.push(userCheckout);
    const cacheRoot = freshTmpDir();
    dirs.push(cacheRoot);
    const controlDir = join(cacheRoot, "git-control");
    await ensureControlClone(plumbing, { sourceRepoPath: userCheckout, controlDir });

    await expect(
      freezeIntake({
        plumbing,
        controlDir,
        userCheckoutPath: userCheckout,
        targetRef: "--output=/tmp/whatever",
        plannedWritePaths: [],
      }),
    ).rejects.toBeInstanceOf(UnsafeGitRefError);
  });
});

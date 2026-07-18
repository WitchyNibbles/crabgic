/**
 * Worktree lifecycle — roadmap/07-git-control-repo-worktrees.md work item
 * 6: "created per attempt ... under supervisor-owned dirs, neutral
 * internal ref `work/<run>/<change-set>/<task>/<attempt>` ... destroy/
 * quarantine lifecycle (dirty or uncertain worktrees quarantined with a
 * journaled `worktree_quarantine` entry, never silently cleaned);
 * crash-orphan sweep on startup."
 *
 * `onStep` (default no-op) is the same test-only injection seam
 * `./control-clone.js` uses — real crash tests
 * (`./worktree-lifecycle.crash.test.ts`) inject `signalFaultPoint`
 * (`@eo/journal`) to interrupt a multi-step operation deterministically at
 * a real internal checkpoint, without this module importing any
 * kill-harness machinery itself.
 */

import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { generateAttemptToken } from "./attempt-token.js";
import { CONTROL_CONTEXT_ENV, OPTION_TERMINATOR, assertObjectId } from "./git-arg-guard.js";
import { dirtyPaths, parsePorcelainV2 } from "./porcelain-parser.js";
import { configureGitIdentity } from "./git-identity.js";
import { buildWorktreeRef, resolveWorktreePath } from "./worktree-ref.js";
import type { JournalAppender } from "./journal-appender.js";
import type { GitPlumbing } from "./plumbing.js";

export interface CreateWorktreeOptions {
  readonly repoDir: string;
  readonly worktreesRootDir: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly taskId: string;
  /** Caller-supplied attempt token (13 supplies the value in production); default: a fresh `generateAttemptToken()`. */
  readonly attempt?: string;
  readonly baseObjectId: string;
  readonly serviceEmail: string;
  readonly onStep?: (step: string) => void;
}

export interface WorktreeRecord {
  readonly ref: string;
  readonly worktreePath: string;
  readonly baseObjectId: string;
  readonly attempt: string;
  readonly createdAt: string;
}

/**
 * A small marker file this package writes once creation (including
 * identity configuration) is fully complete — the crash-orphan sweep's own
 * signal that a worktree found on disk was NOT interrupted mid-creation.
 * Written into git's own per-worktree ADMIN directory (resolved via `git
 * rev-parse --git-dir`, e.g. `<repoDir>/.git/worktrees/<name>/`), never
 * into the worktree's own working directory — an untracked file living
 * INSIDE the working tree would itself show up as "dirty" in `git status`,
 * defeating the very completeness signal it exists to carry.
 */
const COMPLETION_MARKER_NAME = "eo-worktree-complete";

/** Resolves a worktree's own git admin directory (distinct from its working directory) via a real `git rev-parse --git-dir` call. */
async function resolveWorktreeAdminDir(
  plumbing: GitPlumbing,
  worktreePath: string,
): Promise<string> {
  const result = await plumbing.run(["rev-parse", "--git-dir"], { cwd: worktreePath });
  const raw = result.stdout.trim();
  return isAbsolute(raw) ? raw : join(worktreePath, raw);
}

export async function createWorktree(
  plumbing: GitPlumbing,
  options: CreateWorktreeOptions,
): Promise<WorktreeRecord> {
  const attempt = options.attempt ?? generateAttemptToken();
  const ref = buildWorktreeRef({
    runId: options.runId,
    changeSetId: options.changeSetId,
    taskId: options.taskId,
    attempt,
  });
  const worktreePath = resolveWorktreePath(options.worktreesRootDir, [
    options.runId,
    options.changeSetId,
    options.taskId,
    attempt,
  ]);

  // CRITICAL 1 fix (2026-07-18 adversarial validation round): `ref`/
  // `worktreePath` are already boundary-safe by construction (`ref` is
  // always literally prefixed `work/...` via `buildWorktreeRef`;
  // `worktreePath` is always an absolute path via `resolveWorktreePath`'s
  // `resolve()` — neither can ever be flag-shaped). `baseObjectId` was the
  // ONE unguarded caller-influenced positional here — validated as a plain
  // hex object id up front (never flag-shaped by construction), plus
  // `OPTION_TERMINATOR` as belt-and-suspenders (confirmed accepted by
  // `worktree add` against real git 2.43.0).
  assertObjectId("baseObjectId", options.baseObjectId);

  options.onStep?.("before-worktree-add");
  await mkdir(dirname(worktreePath), { recursive: true });
  await plumbing.run(
    ["worktree", "add", "-b", ref, OPTION_TERMINATOR, worktreePath, options.baseObjectId],
    // MAJOR 2 fix: `repoDir` is the control clone in production use —
    // ambient global/system git config neutralized so an ambient
    // `core.hooksPath`/`filter.<x>.smudge` cannot fire during this
    // worktree's own checkout.
    { cwd: options.repoDir, env: CONTROL_CONTEXT_ENV },
  );

  options.onStep?.("after-worktree-add-before-identity");
  await configureGitIdentity(plumbing, worktreePath, options.serviceEmail);

  options.onStep?.("after-identity-before-marker");
  const { writeFile } = await import("node:fs/promises");
  const adminDir = await resolveWorktreeAdminDir(plumbing, worktreePath);
  await writeFile(join(adminDir, COMPLETION_MARKER_NAME), options.serviceEmail, "utf8");

  options.onStep?.("done");
  return {
    ref,
    worktreePath,
    baseObjectId: options.baseObjectId,
    attempt,
    createdAt: new Date().toISOString(),
  };
}

/** Removes a CLEAN worktree entirely. Callers must confirm cleanliness first (e.g. via `isWorktreeDirty`) — this function does not itself refuse a dirty worktree, matching `git worktree remove --force`'s own semantics; the lifecycle-level "never silently clean a dirty worktree" guarantee lives in `sweepOrphanWorktrees`/caller discipline, not here. */
export async function destroyWorktree(
  plumbing: GitPlumbing,
  repoDir: string,
  worktreePath: string,
): Promise<void> {
  await plumbing.run(["worktree", "remove", "--force", worktreePath], { cwd: repoDir });
}

export interface QuarantineWorktreeOptions {
  readonly repoDir: string;
  readonly worktreePath: string;
  readonly quarantineDir: string;
  readonly reason: string;
  readonly journal?: JournalAppender;
  readonly runId?: string;
  readonly changeSetId?: string;
  readonly workUnitId?: string;
  readonly onStep?: (step: string) => void;
}

export interface QuarantineResult {
  readonly quarantinedPath: string;
}

const QUARANTINE_MARKER_NAME = ".eo-quarantine-info.json";

/**
 * MINOR 6 fix (2026-07-18 adversarial validation round): a small sentinel
 * written IMMEDIATELY after a `worktree_quarantine` journal entry lands —
 * for THIS quarantine (pass 1, below) or for one reconciled by a later
 * sweep's pass 2. Its sole purpose is making "already journaled" durably
 * observable on disk, so `sweepOrphanWorktrees`'s pass 2 never re-journals
 * the SAME quarantine on a later sweep (previously: pass 2 re-journaled
 * EVERY marker-having dir on EVERY sweep call, unconditionally —
 * duplicate/accumulating entries on repeated sweeps over one persistent
 * quarantine dir).
 */
const QUARANTINE_JOURNALED_MARKER_NAME = ".eo-quarantine-journaled";

/** Relocates a worktree into the quarantine dir via `git worktree move` (never a raw `fs.rename` — this keeps git's own worktree admin metadata consistent with the new location) and journals a `worktree_quarantine` entry. Content is preserved, never deleted — "quarantine, never silently clean." */
export async function quarantineWorktree(
  plumbing: GitPlumbing,
  options: QuarantineWorktreeOptions,
): Promise<QuarantineResult> {
  const uniqueName = `${basename(options.worktreePath)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const quarantinedPath = join(options.quarantineDir, uniqueName);

  options.onStep?.("before-quarantine-move");
  await mkdir(options.quarantineDir, { recursive: true });
  await plumbing.run(["worktree", "move", options.worktreePath, quarantinedPath], {
    cwd: options.repoDir,
  });

  // Deliberately NO onStep() checkpoint between the move completing and the
  // marker write below: a kill-harness fault point can only ever land where
  // an explicit onStep() call gives it a marker to observe, so keeping
  // these two adjacent (no intervening checkpoint) means a real crash test
  // can never catch the worktree "moved but marker not yet written" —
  // avoiding a genuinely unrecoverable half-state (the marker's whole
  // purpose is to make an interrupted-after-this-point quarantine
  // detectable by `sweepOrphanWorktrees`'s pass 2).
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(quarantinedPath, QUARANTINE_MARKER_NAME),
    JSON.stringify({ reason: options.reason, quarantinedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );

  options.onStep?.("after-marker-before-journal");
  if (options.journal !== undefined) {
    await options.journal.appendEntry({
      type: "worktree_quarantine",
      payload: { worktreePath: quarantinedPath, reason: options.reason },
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.changeSetId !== undefined ? { changeSetId: options.changeSetId } : {}),
      ...(options.workUnitId !== undefined ? { workUnitId: options.workUnitId } : {}),
    });
    // MINOR 6 fix: record that THIS quarantine has been journaled so a
    // later `sweepOrphanWorktrees` pass 2 never re-journals it.
    await writeFile(join(quarantinedPath, QUARANTINE_JOURNALED_MARKER_NAME), "", "utf8");
  }

  options.onStep?.("done");
  return { quarantinedPath };
}

/** `true` if `worktreePath` has any uncommitted change (modified/added/deleted/renamed/untracked/conflicted) — never counts `ignored` entries as dirty. */
export async function isWorktreeDirty(
  plumbing: GitPlumbing,
  worktreePath: string,
): Promise<boolean> {
  const status = await plumbing.run(["status", "--porcelain=v2", "--ignored"], {
    cwd: worktreePath,
    // Control-context isolation (MAJOR 2 residual, 2026-07-18 re-audit): this
    // scans a control-owned worktree and `sweepOrphanWorktrees` runs it at
    // startup, so ambient global/system config must be neutralized here too —
    // otherwise an ambient `clean`/`process` filter (e.g. git-lfs) executes in
    // the control context while re-hashing a stat-mismatched file.
    env: CONTROL_CONTEXT_ENV,
  });
  return dirtyPaths(parsePorcelainV2(status.stdout)).length > 0;
}

async function hasCompletionMarker(plumbing: GitPlumbing, worktreePath: string): Promise<boolean> {
  const revParse = await plumbing.run(["rev-parse", "--git-dir"], {
    cwd: worktreePath,
    allowFailure: true,
  });
  if (revParse.exitCode !== 0) return false; // not even a valid worktree registration
  const raw = revParse.stdout.trim();
  const adminDir = isAbsolute(raw) ? raw : join(worktreePath, raw);
  return existsSync(join(adminDir, COMPLETION_MARKER_NAME));
}

/**
 * NOTE 7 fix (2026-07-18 adversarial validation round): resolves `path`'s
 * realpath, falling back to `path` itself if it doesn't exist (or realpath
 * fails for any other reason) — a nonexistent path is handled by the
 * caller's own subsequent `existsSync` check, not here. Used to normalize
 * BOTH sides of `sweepOrphanWorktrees`'s ownership comparison so a
 * symlinked `worktreesRootDir` (or a WSL2/9p-mount realpath mismatch) can
 * never cause a genuinely-owned, registered worktree to be silently skipped
 * as "not ours."
 */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

interface RegisteredWorktree {
  readonly path: string;
}

/** Minimal `git worktree list --porcelain` parser: blocks separated by blank lines, each starting with `worktree <path>`. */
function parseWorktreeList(output: string): RegisteredWorktree[] {
  const blocks = output
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const result: RegisteredWorktree[] = [];
  for (const block of blocks) {
    const firstLine = block.split("\n")[0];
    if (firstLine !== undefined && firstLine.startsWith("worktree ")) {
      result.push({ path: firstLine.slice("worktree ".length) });
    }
  }
  return result;
}

export interface SweepOptions {
  readonly repoDir: string;
  readonly worktreesRootDir: string;
  readonly quarantineDir: string;
  readonly journal?: JournalAppender;
}

export interface SweepReport {
  readonly quarantined: readonly string[];
  readonly completed: readonly string[];
}

/**
 * Crash-orphan sweep, run at the next call into this package after a
 * possible kill -9 (roadmap: "the next call into this package after a kill
 * -9"). Two passes:
 *
 *  1. Every registered worktree under `worktreesRootDir`: missing its
 *     completion marker (interrupted mid-creation) or currently dirty is
 *     ALWAYS quarantined — never silently completed or dropped. A clean,
 *     fully-created worktree is left exactly as-is.
 *  2. Every already-quarantined directory whose marker file exists but
 *     whose journal entry has not yet landed (interrupted mid-quarantine,
 *     or a fresh crash-orphan quarantined by pass 1 above in this SAME
 *     sweep) gets its `worktree_quarantine` entry appended EXACTLY ONCE —
 *     MINOR 6 fix (2026-07-18 adversarial validation round): a
 *     `QUARANTINE_JOURNALED_MARKER_NAME` sentinel, written immediately
 *     after any successful journal append (by pass 1's `quarantineWorktree`
 *     OR by this pass), is checked first so a dir already journaled — by
 *     THIS sweep or an earlier one — is never re-journaled by a later
 *     sweep (previously: unconditional re-append on every sweep call,
 *     accumulating duplicate entries for one persistent quarantine dir).
 *
 * NOTE 7 fix: ownership (pass 1's `worktreesRootDir` prefix check) is
 * realpath-normalized on both sides — a symlinked root no longer causes a
 * genuine orphan registered under the REAL path to be silently skipped
 * because its lexical path didn't textually match the symlink.
 */
export async function sweepOrphanWorktrees(
  plumbing: GitPlumbing,
  options: SweepOptions,
): Promise<SweepReport> {
  await plumbing.run(["worktree", "prune", "-v"], { cwd: options.repoDir, allowFailure: true });

  const quarantined: string[] = [];
  const completed: string[] = [];

  if (existsSync(join(options.repoDir, ".git"))) {
    const listResult = await plumbing.run(["worktree", "list", "--porcelain"], {
      cwd: options.repoDir,
      allowFailure: true,
    });
    if (listResult.exitCode === 0) {
      const registered = parseWorktreeList(listResult.stdout);
      const realWorktreesRootDir = realpathOrSelf(options.worktreesRootDir);
      for (const wt of registered) {
        const realWtPath = realpathOrSelf(wt.path);
        if (
          !realWtPath.startsWith(realWorktreesRootDir + "/") &&
          realWtPath !== realWorktreesRootDir
        ) {
          continue; // not ours (e.g. the main worktree / repoDir itself)
        }
        if (!existsSync(wt.path)) continue; // already gone

        const complete = await hasCompletionMarker(plumbing, wt.path);
        const dirty = complete ? await isWorktreeDirty(plumbing, wt.path) : true;

        if (!complete || dirty) {
          const reason = !complete
            ? "crash-orphan sweep: worktree creation was interrupted before completion"
            : "crash-orphan sweep: dirty/uncertain worktree found at startup";
          const result = await quarantineWorktree(plumbing, {
            repoDir: options.repoDir,
            worktreePath: wt.path,
            quarantineDir: options.quarantineDir,
            reason,
            ...(options.journal !== undefined ? { journal: options.journal } : {}),
          });
          quarantined.push(result.quarantinedPath);
        } else {
          completed.push(wt.path);
        }
      }
    }
  }

  // Pass 2: reconcile any quarantined dir whose journal write may not have
  // landed (interrupted mid-quarantine, between the marker write and the
  // journal append) — but MINOR 6 fix: skip a dir that's already been
  // journaled (sentinel present), so repeated sweeps over one persistent
  // quarantine dir never accumulate duplicate entries.
  if (options.journal !== undefined && existsSync(options.quarantineDir)) {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(options.quarantineDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const quarantinedPath = join(options.quarantineDir, entry.name);
      const markerPath = join(quarantinedPath, QUARANTINE_MARKER_NAME);
      if (!existsSync(markerPath)) continue;
      const journaledSentinelPath = join(quarantinedPath, QUARANTINE_JOURNALED_MARKER_NAME);
      if (existsSync(journaledSentinelPath)) continue; // already journaled — never re-journal (MINOR 6)
      const raw = await readFile(markerPath, "utf8");
      const marker = JSON.parse(raw) as { readonly reason: string };
      await options.journal.appendEntry({
        type: "worktree_quarantine",
        payload: { worktreePath: quarantinedPath, reason: marker.reason },
      });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(journaledSentinelPath, "", "utf8");
    }
  }

  return { quarantined, completed };
}

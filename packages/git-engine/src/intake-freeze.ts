/**
 * Intake freeze — roadmap/07-git-control-repo-worktrees.md work item 5:
 * "intake freeze (target ref, exact base object ID, repo format,
 * porcelain-v2 dirty snapshot of the user checkout; planned-write vs
 * dirty-path overlap → typed block naming the offending paths; unrelated
 * dirt untouched) + journaled `git_freeze` entry."
 *
 * This structure is deliberately a `packages/git-engine`-internal
 * structure, NOT a `packages/contracts` schema (roadmap §Interfaces
 * produced: "Not a `packages/contracts` schema — a `packages/git-engine`-
 * internal structure whose relevant fields feed 02-owned contracts
 * downstream," e.g. `baseObjectId` threading into 13's `TaskPacket.baseObjectId`
 * and 08's CAS "expected-old-value"). `freezeIntake` never mutates the
 * user checkout — it only ever reads (`git rev-parse`, `git status
 * --porcelain=v2`) — so "unrelated dirt untouched" holds by construction,
 * not by an extra guard.
 */

import {
  CONTROL_CONTEXT_ENV,
  OPTION_TERMINATOR,
  USER_CHECKOUT_READ_ENV,
  assertSafeRefPositional,
} from "./git-arg-guard.js";
import { dirtyPaths, parsePorcelainV2, type PorcelainV2Snapshot } from "./porcelain-parser.js";
import { validateRepository, type RepositoryValidationReport } from "./repo-validation.js";
import type { JournalAppender } from "./journal-appender.js";
import type { GitPlumbing } from "./plumbing.js";

export type { JournalAppender } from "./journal-appender.js";

export interface IntakeFreezeRecord {
  readonly targetRef: string;
  readonly baseObjectId: string;
  readonly repositoryFormat: RepositoryValidationReport;
  readonly dirtySnapshot: PorcelainV2Snapshot;
  readonly frozenAt: string;
}

export type IntakeFreezeResult =
  | { readonly status: "frozen"; readonly freeze: IntakeFreezeRecord }
  | {
      readonly status: "blocked";
      readonly offendingPaths: readonly string[];
      readonly freeze: IntakeFreezeRecord;
    };

export interface FreezeIntakeOptions {
  readonly plumbing: GitPlumbing;
  /** An already-cloned (and, if needed, already fetch-refreshed) control clone directory — see `./control-clone.js`. */
  readonly controlDir: string;
  /** The real user checkout to snapshot dirty state of; NEVER written to. */
  readonly userCheckoutPath: string;
  readonly targetRef: string;
  readonly plannedWritePaths: readonly string[];
  readonly journal?: JournalAppender;
  readonly runId?: string;
  readonly changeSetId?: string;
  readonly workUnitId?: string;
}

function buildReason(
  targetRef: string,
  baseObjectId: string,
  offendingPaths: readonly string[],
): string {
  return offendingPaths.length > 0
    ? `intake freeze BLOCKED at ${targetRef}@${baseObjectId}: planned writes intersect dirty paths: ${offendingPaths.join(", ")}`
    : `intake freeze committed at ${targetRef}@${baseObjectId}`;
}

export async function freezeIntake(options: FreezeIntakeOptions): Promise<IntakeFreezeResult> {
  const { plumbing, controlDir, userCheckoutPath, targetRef, plannedWritePaths, journal } = options;

  // CRITICAL 1 fix (2026-07-18 adversarial validation round): `targetRef`
  // is a caller-influenced positional — reject a flag-shaped value up
  // front. `OPTION_TERMINATOR` alone is NOT sufficient for `rev-parse`:
  // unlike `clone`/`fetch`/`diff`/`worktree add`, `rev-parse`'s own
  // hand-rolled parser only honors `--end-of-options` when paired with
  // `--verify` (confirmed against real git 2.43.0 — see
  // `git-arg-guard.ts`'s doc comment and `git rev-parse --help`'s own
  // documented example); without `--verify` it echoes the literal
  // `--end-of-options` token to stdout instead, which would corrupt this
  // function's `stdout.trim()` parsing.
  assertSafeRefPositional("targetRef", targetRef);
  const revParse = await plumbing.run(
    ["rev-parse", "--verify", OPTION_TERMINATOR, targetRef],
    // MAJOR 2 fix: this reads the control clone, not the user checkout —
    // ambient global/system git config neutralized like every other
    // control-context operation.
    { cwd: controlDir, env: CONTROL_CONTEXT_ENV },
  );
  const baseObjectId = revParse.stdout.trim();

  const repositoryFormat = await validateRepository(plumbing, userCheckoutPath);

  // MINOR 4 fix: reading the USER checkout's status must never mutate its
  // `.git/index` as a side effect (git's own "racy git" stat-cache
  // refresh — empirically confirmed to rewrite `.git/index` bytes on a
  // plain `git status` against real git 2.43.0 during this fix's RED
  // phase). `--no-optional-locks` (flag) + `GIT_OPTIONAL_LOCKS=0` (env)
  // are two independent mechanisms for the identical switch — both used,
  // belt-and-suspenders. Deliberately NOT `CONTROL_CONTEXT_ENV` here: this
  // package never owns/overrides the USER's own git config, only the
  // control clone's (see `./git-arg-guard.ts`'s doc comment).
  const statusResult = await plumbing.run(
    ["--no-optional-locks", "status", "--porcelain=v2", "--ignored"],
    {
      cwd: userCheckoutPath,
      env: USER_CHECKOUT_READ_ENV,
    },
  );
  const dirtySnapshot = parsePorcelainV2(statusResult.stdout);
  const dirtySet = new Set(dirtyPaths(dirtySnapshot));
  const offendingPaths = plannedWritePaths.filter((p) => dirtySet.has(p));

  const freeze: IntakeFreezeRecord = {
    targetRef,
    baseObjectId,
    repositoryFormat,
    dirtySnapshot,
    frozenAt: new Date().toISOString(),
  };

  if (journal !== undefined) {
    await journal.appendEntry({
      type: "git_freeze",
      payload: {
        scopePath: userCheckoutPath,
        reason: buildReason(targetRef, baseObjectId, offendingPaths),
      },
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.changeSetId !== undefined ? { changeSetId: options.changeSetId } : {}),
      ...(options.workUnitId !== undefined ? { workUnitId: options.workUnitId } : {}),
    });
  }

  return offendingPaths.length > 0
    ? { status: "blocked", offendingPaths, freeze }
    : { status: "frozen", freeze };
}

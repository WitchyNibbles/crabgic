/**
 * CAS ref update — roadmap/08-integration-publication.md work item 2:
 * "CAS update (`applyCasUpdate`) + bounded rebuild/reverify loop, journaled
 * as `cas_ref_update`. Failing-first: two concurrent updates racing the
 * same `expectedOldValue` — the loser must retry-rebuild-or-block, never
 * silently overwrite." §Interfaces produced: "wraps `git update-ref`
 * compare-and-swap; on a lost race, drives the bounded rebuild-and-reverify
 * loop. Every attempt is journaled as a `cas_ref_update`-typed entry."
 *
 * `git update-ref <ref> <new> <old>` (confirmed against real git 2.43.0,
 * this phase's own spike): succeeds (exit 0) only if `<ref>`'s CURRENT value
 * is exactly `<old>` — a mismatch fails (non-zero exit, ref left completely
 * untouched) with git's own "is at X but expected Y" message. This is git's
 * native compare-and-swap primitive; no separate locking is layered on top
 * (git's own ref-lock already makes one `update-ref` call atomic).
 * `--end-of-options` is confirmed accepted by `update-ref` (this phase's own
 * spike, mirroring `git-arg-guard.ts`'s existing confirmed set).
 *
 * REBUILD LOOP: on a lost race, this function resolves the ref's actual
 * current value (`git rev-parse --verify`) and, if a `rebuild` callback was
 * supplied, calls it with that value to obtain a fresh candidate `newValue`
 * to retry with — bounded by `maxAttempts` (default 5), converging or
 * returning `{ status: "blocked" }` rather than looping forever (roadmap
 * §Risks: "Rebuild-and-reverify loop must terminate"). Every attempt —
 * whether it wins or loses the race — is journaled as its own
 * `cas_ref_update` entry (the payload schema records only `{ ref, objectId }`,
 * the value THIS attempt targeted; a reader cross-references against the
 * ref's actual final state to see which attempt won), so a blocked outcome
 * still has "a journaled `cas_ref_update` entry" per the roadmap's own exit
 * criterion, not zero entries.
 */

import {
  CONTROL_CONTEXT_ENV,
  OPTION_TERMINATOR,
  assertObjectId,
  assertSafeRefPositional,
} from "./git-arg-guard.js";
import {
  buildCasRefUpdateEntryInput,
  type IntegrationJournalAppender,
} from "./integration-journal.js";
import { withTreeInvariance } from "./invariance.js";
import type { GitPlumbing } from "./plumbing.js";

const ZERO_OID = "0".repeat(40);
const DEFAULT_MAX_ATTEMPTS = 5;

export interface RebuildOutcome {
  readonly newValue: string;
}

export interface RebuildBlocked {
  readonly blocked: true;
  readonly reason: string;
}

/** Caller-supplied "recompute a fresh candidate against the ref's new tip" step (typically: re-run `preflightMerge` against `currentRefValue`). Sync or async. */
export type RebuildFn = (
  currentRefValue: string,
  attempt: number,
) => RebuildOutcome | RebuildBlocked | Promise<RebuildOutcome | RebuildBlocked>;

export interface ApplyCasUpdateOptions {
  /** A real on-disk repo owning `ref` (the control clone, typically). */
  readonly repoDir: string;
  readonly ref: string;
  readonly expectedOldValue: string;
  readonly newValue: string;
  readonly journal?: IntegrationJournalAppender;
  readonly runId?: string;
  readonly changeSetId?: string;
  readonly workUnitId?: string;
  /** Bounded rebuild-attempt cap (roadmap §Risks: "must terminate"); default 5. */
  readonly maxAttempts?: number;
  /** Recomputes a fresh candidate on a lost race; omit to block immediately on the first lost race. */
  readonly rebuild?: RebuildFn;
}

export type CasUpdateResult =
  | {
      readonly status: "applied";
      readonly ref: string;
      readonly objectId: string;
      readonly attempts: number;
    }
  | {
      readonly status: "blocked";
      readonly ref: string;
      readonly attempts: number;
      readonly reason: string;
    };

interface UpdateRefAttemptOutcome {
  readonly succeeded: boolean;
  readonly currentValue: string;
}

async function tryUpdateRef(
  plumbing: GitPlumbing,
  repoDir: string,
  ref: string,
  newValue: string,
  expectedOldValue: string,
): Promise<UpdateRefAttemptOutcome> {
  assertSafeRefPositional("ref", ref);
  assertObjectId("newValue", newValue);
  assertObjectId("expectedOldValue", expectedOldValue);

  const result = await plumbing.run(
    ["update-ref", OPTION_TERMINATOR, ref, newValue, expectedOldValue],
    {
      cwd: repoDir,
      env: CONTROL_CONTEXT_ENV,
      allowFailure: true,
    },
  );
  if (result.exitCode === 0) {
    return { succeeded: true, currentValue: newValue };
  }

  // Lost the race (or a genuine other failure) — resolve the ref's ACTUAL
  // current value so a caller's `rebuild` step has real ground truth to
  // recompute against. `--verify` pairs with `OPTION_TERMINATOR` per this
  // package's documented rev-parse quirk (git-arg-guard.ts).
  const revParse = await plumbing.run(["rev-parse", "--verify", OPTION_TERMINATOR, ref], {
    cwd: repoDir,
    env: CONTROL_CONTEXT_ENV,
    allowFailure: true,
  });
  const currentValue = revParse.exitCode === 0 ? revParse.stdout.trim() : ZERO_OID;
  return { succeeded: false, currentValue };
}

/**
 * `applyCasUpdate(plumbing, options)` — see this file's doc comment for the
 * documented signature deviation (this package's established
 * `(plumbing, options)` convention) from the roadmap's bare-positional
 * prose. Wrapped in `withTreeInvariance` — `update-ref`/`rev-parse` never
 * touch the working tree, only `.git/refs` (ignored by the working-tree
 * hash), so this proves that structurally.
 */
export async function applyCasUpdate(
  plumbing: GitPlumbing,
  options: ApplyCasUpdateOptions,
): Promise<CasUpdateResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const correlation = {
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    ...(options.changeSetId !== undefined ? { changeSetId: options.changeSetId } : {}),
    ...(options.workUnitId !== undefined ? { workUnitId: options.workUnitId } : {}),
  };

  return withTreeInvariance(options.repoDir, async () => {
    let attempt = 0;
    let candidateOldValue = options.expectedOldValue;
    let candidateNewValue = options.newValue;

    while (attempt < maxAttempts) {
      attempt += 1;
      const outcome = await tryUpdateRef(
        plumbing,
        options.repoDir,
        options.ref,
        candidateNewValue,
        candidateOldValue,
      );

      if (options.journal !== undefined) {
        await options.journal.appendEntry(
          buildCasRefUpdateEntryInput(options.ref, candidateNewValue, correlation),
        );
      }

      if (outcome.succeeded) {
        return {
          status: "applied",
          ref: options.ref,
          objectId: candidateNewValue,
          attempts: attempt,
        };
      }

      if (options.rebuild === undefined) {
        return {
          status: "blocked",
          ref: options.ref,
          attempts: attempt,
          reason: `cas_ref_update: lost the race on "${options.ref}" (now at ${outcome.currentValue}) and no rebuild function was supplied`,
        };
      }

      if (attempt === maxAttempts) {
        break; // no budget left for another attempt — fall through to the exhausted-blocked return below, without wastefully invoking `rebuild` one more time.
      }

      const rebuilt = await options.rebuild(outcome.currentValue, attempt);
      if ("blocked" in rebuilt) {
        return { status: "blocked", ref: options.ref, attempts: attempt, reason: rebuilt.reason };
      }
      candidateOldValue = outcome.currentValue;
      candidateNewValue = rebuilt.newValue;
    }

    return {
      status: "blocked",
      ref: options.ref,
      attempts: attempt,
      reason: `cas_ref_update: exhausted ${String(maxAttempts)} rebuild attempts on "${options.ref}" without converging`,
    };
  });
}

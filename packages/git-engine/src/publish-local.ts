/**
 * Local publication — roadmap/08-integration-publication.md work item 6:
 * "Local publish routine (`publishLocal`) + invariance-harness extension
 * (07) + fake-remote assertion that nothing is pushed. Failing-first: a
 * publish test on a fixture repo must show no branch and no evidence before
 * the routine exists; after, the branch appears, the user checkout is
 * byte-identical, and there is zero remote interaction." §In scope:
 * "final branch created in the USER's repo without checkout or push
 * (`git fetch <control-repo> <ref>:refs/heads/<branch>` run in the user
 * repo ...); HEAD/index/worktree untouched."
 *
 * NEVER pushes, never checks out, never touches HEAD/index/working tree —
 * the ONE write this phase ever makes into user space is exactly the
 * `git fetch <source> <ref>:refs/heads/<branch>` invocation below. A fetch
 * with an explicit destination refspec (`<src>:refs/heads/<branch>`) only
 * ever creates/updates that ONE ref and fetches the objects it needs — it
 * never touches `HEAD`, the index, or the working tree.
 *
 * INVARIANCE-HARNESS EXTENSION (documented, not a silent reuse): 07's own
 * `withUserCheckoutInvariance` combines the working-tree hash with a hash of
 * `HEAD`/`config`/`index`/`packed-refs`/every LOOSE REF FILE — correct for
 * an operation that must leave a user checkout in EVERY respect untouched
 * (07's own `freezeIntake`, a pure read). This operation's entire PURPOSE is
 * to add exactly one new loose ref, so wrapping it in that same combined
 * hash would (correctly) detect its own intended effect as a "mutation" and
 * always fail. This module therefore EXTENDS 07's harness with a narrower,
 * purpose-built check for exactly what this operation promises to leave
 * alone — the working tree (reusing `computeWorkingTreeHash` directly,
 * unmodified) plus `HEAD` and `index` specifically (this file's own small
 * digest, deliberately excluding `refs/`, which is expected to gain exactly
 * one new file) — proving "HEAD/index/worktree untouched" precisely, rather
 * than a broader (and here incorrect) "nothing in `.git` changed at all."
 *
 * `GIT_TERMINAL_PROMPT=0` (this file's own minimal, scoped env — NOT 07's
 * `CONTROL_CONTEXT_ENV`, which additionally forces
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM=/dev/null`; that override is
 * reserved for CONTROL-context operations and is deliberately never applied
 * to a real user checkout, per `git-arg-guard.ts`'s own documented
 * boundary) only prevents a non-interactive hang; it never redirects which
 * config sources the user's own repository reads.
 *
 * PUBLICATION-TIME ATTRIBUTION BELT-AND-SUSPENDERS (2026-07-24
 * adversarial-validation fix, MEDIUM finding — confirmed absent):
 * roadmap/08 §In scope's own "Belt-and-suspenders" bullet: "publication
 * asserts rendered commits carry no engine attribution regardless of host
 * settings, independent of whatever 03/06 configured in the worker's own
 * settings — a redundant second enforcement layer, not a substitute for
 * 17's lint." This was previously entirely absent — `publishLocal` checked
 * ONLY HEAD/index/worktree invariance, never re-inspecting what it actually
 * published. After a successful fetch, this module now computes exactly
 * the set of commits THIS publish newly introduced (reachable from the new
 * branch tip, not reachable from anything that already existed in the
 * user's repo before the fetch — captured via `for-each-ref` BEFORE the
 * fetch runs, since after the fetch the new branch itself would otherwise
 * self-exclude via a naive `--not --all`), and re-scans each one's full
 * commit message with `@eo/contracts`'s `scanForAttributionTokens` — the
 * SAME shared primitive 17's `attribution-neutral` lint stage and this
 * phase's own `renderer-corpus-shared.test.ts` already reuse (never
 * forked). FAILS CLOSED: on any hit, the just-created branch ref is
 * deleted (`update-ref -d`, never left dangling/tainted for a caller to
 * stumble on) and `PublishedAttributionLeakError` is thrown — this is a
 * "should never happen, the primary defense already failed" condition,
 * matching this file's own `PublishLocalInvarianceViolationError`
 * precedent (thrown, not returned as an ordinary `blocked` outcome).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanForAttributionTokens } from "@eo/contracts";
import {
  OPTION_TERMINATOR,
  USER_CHECKOUT_READ_ENV,
  assertObjectId,
  assertSafeRefPositional,
} from "./git-arg-guard.js";
import { computeWorkingTreeHash } from "./invariance.js";
import type { GitPlumbing } from "./plumbing.js";

/** Prevents a non-interactive hang on an unreachable/prompting transport; deliberately does NOT touch which git config sources the user's own repository reads (see file-level doc comment). */
const NO_TERMINAL_PROMPT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
});

/** Mirrors `git-arg-guard.ts`'s own object-id shape (not re-exported there) — used here only to filter, never to reject-with-throw, `for-each-ref`'s own output (see `listNewlyIntroducedCommits`'s doc comment). */
const OBJECT_ID_SHAPE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** `HEAD`/`index` only — deliberately excludes `refs/`/`config`/`packed-refs` (see file-level doc comment on why 07's own combined `withUserCheckoutInvariance` is not reused as-is here). */
function computeHeadAndIndexDigest(repoPath: string): string {
  const hash = createHash("sha256");
  for (const name of ["HEAD", "index"]) {
    const filePath = join(repoPath, ".git", name);
    if (!existsSync(filePath)) continue;
    hash.update(`file:${name}\n`);
    hash.update(readFileSync(filePath));
    hash.update("\n--\n");
  }
  return hash.digest("hex");
}

async function computePublishInvarianceDigest(repoPath: string): Promise<string> {
  const treeHash = await computeWorkingTreeHash(repoPath);
  return `${treeHash}:${computeHeadAndIndexDigest(repoPath)}`;
}

function parseLines(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Every ref tip already present in `repoPath` — captured BEFORE the fetch runs, so the newly-created destination branch can never self-exclude itself from the "already known" set (see file-level doc comment). */
async function listExistingRefTips(
  plumbing: GitPlumbing,
  repoPath: string,
): Promise<readonly string[]> {
  const result = await plumbing.run(["for-each-ref", "--format=%(objectname)"], {
    cwd: repoPath,
    env: USER_CHECKOUT_READ_ENV,
    allowFailure: true,
  });
  return result.exitCode === 0 ? parseLines(result.stdout) : [];
}

/**
 * Every commit reachable from `tipObjectId` that was NOT reachable from any
 * of `preExistingTips` — i.e. exactly the commits THIS publish newly
 * introduced.
 *
 * ARGV ORDERING NOTE (this phase's own spike against real git 2.43.0):
 * `git rev-list --end-of-options <tip> --not <excludes...>` FAILS outright
 * ("option '--not' must come before non-option arguments") — placing the
 * terminator before `--not` makes git treat `--not` itself as an ordinary
 * (invalid) positional instead of the special exclude-toggle. The
 * terminator therefore goes AFTER `--not`, immediately before the exclude
 * list — `git rev-list <tip> --not --end-of-options <excludes...>` is
 * confirmed to work. `tipObjectId` is validated via `assertObjectId`
 * instead of a positional terminator (equivalent protection: a
 * flag-shaped value is rejected outright before ever reaching git); it is
 * always this module's own `git rev-parse` output, never raw caller input,
 * but validated anyway per this package's belt-and-suspenders discipline.
 * `preExistingTips` are `for-each-ref`'s own `%(objectname)` output —
 * always well-formed hex object ids by construction — but filtered through
 * the same hex shape here too rather than trusted blindly; a would-be
 * malformed entry is simply dropped (over-inclusive on the "newly
 * introduced" side is the safe failure direction: at worst an
 * already-existing commit gets re-scanned, never a leak missed).
 */
async function listNewlyIntroducedCommits(
  plumbing: GitPlumbing,
  repoPath: string,
  tipObjectId: string,
  preExistingTips: readonly string[],
): Promise<readonly string[]> {
  assertObjectId("tipObjectId", tipObjectId);
  const safeExcludes = preExistingTips.filter((tip) => OBJECT_ID_SHAPE.test(tip));

  const result = await plumbing.run(
    ["rev-list", tipObjectId, "--not", OPTION_TERMINATOR, ...safeExcludes],
    { cwd: repoPath, env: USER_CHECKOUT_READ_ENV, allowFailure: true },
  );
  return result.exitCode === 0 ? parseLines(result.stdout) : [];
}

export interface AttributionLeak {
  readonly commitId: string;
  readonly token: string;
}

/** Scans each of `commitIds`' full commit message (subject + body) for an attribution token, reusing (never forking) `@eo/contracts`'s `scanForAttributionTokens` — the same primitive 17's lint stage and this phase's own shared-corpus suite already build on. Returns the FIRST hit, or `undefined` if every commit is clean. */
async function findAttributionLeak(
  plumbing: GitPlumbing,
  repoPath: string,
  commitIds: readonly string[],
): Promise<AttributionLeak | undefined> {
  for (const commitId of commitIds) {
    const result = await plumbing.run(["log", "-1", "--format=%B", OPTION_TERMINATOR, commitId], {
      cwd: repoPath,
      env: USER_CHECKOUT_READ_ENV,
      allowFailure: true,
    });
    if (result.exitCode !== 0) continue;
    const findings = scanForAttributionTokens(result.stdout);
    if (findings.length > 0) {
      return { commitId, token: findings[0]!.token };
    }
  }
  return undefined;
}

export interface PublishLocalOptions {
  /** The real user checkout — a `git fetch` runs inside it; HEAD/index/working tree are asserted untouched. */
  readonly userRepoPath: string;
  /** The control clone's own directory (07's `$XDG_CACHE_HOME/.../git-control/`) — the fetch SOURCE, a local filesystem path, never a remote URL. */
  readonly controlRepoPath: string;
  /** The ref within the control clone whose tip becomes the new local branch (typically the CAS-updated integration ref). */
  readonly sourceRef: string;
  /** The destination branch name in the user's repo (typically `nameBranch`'s own output) — already git-ref-legal by construction. */
  readonly branchName: string;
}

export type PublishResult =
  | { readonly status: "published"; readonly branchName: string; readonly objectId: string }
  | { readonly status: "blocked"; readonly reason: string };

export class PublishLocalInvarianceViolationError extends Error {
  constructor(repoPath: string) {
    super(
      `publish-local: HEAD/index/working-tree of "${repoPath}" changed during publishLocal — this operation must touch only refs/`,
    );
    this.name = "PublishLocalInvarianceViolationError";
  }
}

/**
 * Thrown by the belt-and-suspenders attribution re-check (2026-07-24 fix,
 * MEDIUM finding) when a published commit carries an attribution token
 * despite 17's lint already running upstream — a "the primary defense
 * already failed" condition, matching `PublishLocalInvarianceViolationError`'s
 * own thrown-not-returned precedent in this file. The just-created branch
 * ref is deleted BEFORE this is thrown (fail closed — never leave a
 * tainted branch behind for a caller to stumble on).
 */
export class PublishedAttributionLeakError extends Error {
  readonly commitId: string;
  readonly token: string;

  constructor(commitId: string, token: string) {
    super(
      `publish-local: commit ${commitId} carries attribution ("${token}") — belt-and-suspenders check refused publication; the branch has been removed`,
    );
    this.name = "PublishedAttributionLeakError";
    this.commitId = commitId;
    this.token = token;
  }
}

/**
 * `publishLocal(plumbing, options)` — see file-level doc comment for the
 * documented signature deviation (this package's established
 * `(plumbing, options)` convention) from the roadmap's bare-positional
 * prose.
 */
export async function publishLocal(
  plumbing: GitPlumbing,
  options: PublishLocalOptions,
): Promise<PublishResult> {
  assertSafeRefPositional("controlRepoPath", options.controlRepoPath);
  assertSafeRefPositional("sourceRef", options.sourceRef);
  assertSafeRefPositional("branchName", options.branchName);

  const refspec = `${options.sourceRef}:refs/heads/${options.branchName}`;
  const beforeDigest = await computePublishInvarianceDigest(options.userRepoPath);
  // Captured BEFORE the fetch — see `listNewlyIntroducedCommits`'s doc
  // comment for why this ordering is load-bearing.
  const preExistingTips = await listExistingRefTips(plumbing, options.userRepoPath);

  const result = await plumbing.run(
    ["fetch", OPTION_TERMINATOR, options.controlRepoPath, refspec],
    {
      cwd: options.userRepoPath,
      env: NO_TERMINAL_PROMPT_ENV,
      allowFailure: true,
    },
  );

  const afterDigest = await computePublishInvarianceDigest(options.userRepoPath);
  if (afterDigest !== beforeDigest) {
    throw new PublishLocalInvarianceViolationError(options.userRepoPath);
  }

  if (result.exitCode !== 0) {
    return {
      status: "blocked",
      reason: result.stderr.trim() || `git fetch exited ${result.exitCode}`,
    };
  }

  const revParse = await plumbing.run(
    ["rev-parse", "--verify", OPTION_TERMINATOR, `refs/heads/${options.branchName}`],
    { cwd: options.userRepoPath, allowFailure: true },
  );
  if (revParse.exitCode !== 0) {
    return {
      status: "blocked",
      reason: "fetch reported success but the destination ref is not resolvable",
    };
  }

  const publishedObjectId = revParse.stdout.trim();

  // Belt-and-suspenders (2026-07-24 fix, MEDIUM finding): re-inspect every
  // commit THIS publish actually introduced for engine attribution,
  // independent of whatever 03/06 configured upstream — see file-level doc
  // comment.
  const newCommitIds = await listNewlyIntroducedCommits(
    plumbing,
    options.userRepoPath,
    publishedObjectId,
    preExistingTips,
  );
  const leak = await findAttributionLeak(plumbing, options.userRepoPath, newCommitIds);
  if (leak !== undefined) {
    await plumbing.run(
      ["update-ref", "-d", OPTION_TERMINATOR, `refs/heads/${options.branchName}`],
      {
        cwd: options.userRepoPath,
        allowFailure: true,
      },
    );
    throw new PublishedAttributionLeakError(leak.commitId, leak.token);
  }

  return { status: "published", branchName: options.branchName, objectId: publishedObjectId };
}

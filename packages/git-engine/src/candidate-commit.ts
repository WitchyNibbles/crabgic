/**
 * Candidate commits — the two git primitives phase 08's integration half
 * needed and never had a producer for.
 *
 * WHY THIS MODULE EXISTS. `preflightMerge` takes a `candidateRef`, and
 * `applyCasUpdate` takes a `newValue` object id. Nothing produced either.
 * A succeeded attempt leaves its worktree **dirty**: the compiled worker
 * profile grants exactly four Bash prefixes — `npm run test`, `npm run
 * build`, `git status`, `git diff`
 * (`@crabgic/engine-core`'s `permission-profile.ts`) — so a worker *cannot*
 * commit, by construction and on purpose. Its branch
 * (`work/<run>/<change-set>/<task>/<attempt>`, created at the frozen base by
 * `./worktree-lifecycle.js`) therefore still points at the base until
 * something on the supervisor side collects the work. That collection is
 * {@link commitWorktreeCandidate}.
 *
 * And the merged tree `preflightMerge` returns is a TREE, not a commit — the
 * integration ref advances by commits, so the tree has to be wrapped with the
 * current tip as its parent. That is {@link buildIntegrationCommit}.
 *
 * CONTROL-CONTEXT ONLY. Every call here operates on the control clone or on a
 * worktree OF the control clone — never on a user checkout — so
 * `CONTROL_CONTEXT_ENV` (07's MAJOR-2 discipline: ambient
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` forced to `/dev/null`) applies here
 * exactly as it does to `createWorktree`, `preflightMerge` and
 * `applyCasUpdate`. It is what stops an ambient `core.hooksPath`,
 * `commit.gpgsign` or clean/smudge filter from firing while the supervisor
 * commits on a worker's behalf.
 *
 * IDENTITY RIDES IN THE ENVIRONMENT, NEVER IN A CONFIG WRITE. `createWorktree`
 * already calls `configureGitIdentity` (`git config --local`), and because
 * linked worktrees share the repository's single `.git/config` that write also
 * lands for the control clone. Relying on it would still be relying on a side
 * effect of an unrelated function — and a run whose every unit came back clean
 * never creates a worktree at all, so `commit-tree` in the control clone would
 * have no identity to find. {@link commitAuthorshipEnv} therefore passes
 * author + committer explicitly on the one command that needs them. This
 * module writes no git config.
 */

import type { GitIdentity } from "./git-identity.js";
import { CRABGIC_GIT_IDENTITY_NAME } from "./git-identity.js";
import { CONTROL_CONTEXT_ENV, OPTION_TERMINATOR, assertObjectId } from "./git-arg-guard.js";
import { isWorktreeDirty } from "./worktree-lifecycle.js";
import type { GitPlumbing } from "./plumbing.js";

/**
 * The ref namespace a run's in-progress integration tip lives in, inside the
 * control clone. Deliberately NOT under `refs/heads/`: an integration tip is
 * supervisor bookkeeping, not a branch anyone checks out, and keeping it out
 * of `refs/heads/` means `publishLocal`'s destination refspec
 * (`<src>:refs/heads/<branch>`) can never collide with it.
 */
export const CRABGIC_INTEGRATION_REF_PREFIX = "refs/crabgic/integration";

/** The run-scoped integration ref. Run-scoped rather than change-set-scoped so a retry as a fresh run cannot inherit a previous run's partially-integrated tip. */
export function buildIntegrationRef(runId: string): string {
  return `${CRABGIC_INTEGRATION_REF_PREFIX}/${runId}`;
}

/**
 * Author + committer identity as environment variables — these outrank
 * `user.name`/`user.email` from every config file, so one env overlay covers
 * both the worktree case (where a local identity happens to exist) and the
 * control-clone case (where none does) without a `git config` call anywhere.
 */
export function commitAuthorshipEnv(identity: GitIdentity): Readonly<Record<string, string>> {
  return Object.freeze({
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  });
}

/** The neutral identity every commit this module makes carries — the same name `configureGitIdentity` writes, with the caller's configured service email. */
export function neutralCommitIdentity(serviceEmail: string): GitIdentity {
  return { name: CRABGIC_GIT_IDENTITY_NAME, email: serviceEmail };
}

/**
 * Pathspecs excluded from the collection `git add`.
 *
 * `provisionWorktreeDependencies` (`./worktree-dependencies.js`) creates a
 * real `node_modules` directory inside every attempt worktree, because `npm
 * run test`/`npm run build` are two of only four grantable command prefixes
 * and neither works in a bare `git worktree add`. In a project that gitignores
 * `node_modules` that is invisible here. In one that does NOT, an unqualified
 * `git add --all` would sweep the entire provisioned dependency tree into the
 * candidate commit — supervisor-manufactured content, in a commit that
 * represents a worker's work. Excluded by pathspec rather than trusted to the
 * project's `.gitignore`, which the supervisor does not own.
 */
export const COLLECTION_EXCLUDE_PATHSPECS: readonly string[] = Object.freeze([
  ":(exclude)node_modules",
  ":(exclude,glob)**/node_modules/**",
]);

export interface CommitWorktreeCandidateOptions {
  /** The attempt's own worktree — a worktree OF the control clone (see file-level note on control context). */
  readonly worktreePath: string;
  /** Already rendered through 17's `renderWithRegeneration` by the caller (`./commit-renderer.js`'s `renderCommit`) — this module never assembles message text. */
  readonly subject: string;
  readonly body: string;
  readonly identity: GitIdentity;
  /**
   * The object id this worktree's branch was CREATED at (07's frozen intake
   * freeze). Required, not optional: it is the only way to tell "the worker
   * changed nothing" apart from "the worker committed its own work", and those
   * two must not be confused — see {@link commitWorktreeCandidate}'s
   * ALREADY-COMMITTED WORK note.
   */
  readonly baseObjectId: string;
}

export type CommitWorktreeCandidateResult =
  | { readonly status: "committed"; readonly objectId: string }
  /**
   * Nothing to integrate: the branch tip is still exactly `baseObjectId`, so
   * the worker changed nothing, or its only changes were excluded provisioning
   * (see {@link COLLECTION_EXCLUDE_PATHSPECS}).
   */
  | { readonly status: "nothing-to-commit" };

/**
 * Commits everything the worker left uncommitted in `worktreePath`, returning
 * the new commit's object id — the candidate `preflightMerge` compares against
 * the integration tip.
 *
 * Two-stage emptiness check, and both stages are needed. `isWorktreeDirty`
 * answers "did anything change at all" (and correctly ignores gitignored
 * entries); `git diff --cached --quiet` after the staging step answers "is
 * anything actually STAGED", which is a different question once
 * {@link COLLECTION_EXCLUDE_PATHSPECS} is in play — a worktree whose only
 * untracked content is provisioned `node_modules` is dirty and yet has nothing
 * to commit, and `git commit` on an empty index fails rather than producing an
 * empty commit.
 *
 * ALREADY-COMMITTED WORK IS STILL A CANDIDATE — never silently dropped.
 * "Nothing to commit" is not the same claim as "nothing to integrate", and
 * conflating them would be the worst failure this module could have: a unit
 * whose work never reached the integration ref, inside a run that reports
 * SUCCESS and publishes. Today a worker cannot commit at all (the compiled
 * profile grants no `git commit`), so a clean worktree does mean tip == base —
 * but that is an inference from a permission boundary, and this repository
 * already carries a tracked residual where enabling the OS sandbox
 * auto-allows `Bash` (`docs/security-posture.md`'s sandbox note). So the
 * clean arm RESOLVES THE TIP and compares it, rather than assuming: a tip
 * ahead of the base is returned as the candidate. Both arms are measured, and
 * the assumption is nowhere.
 */
export async function commitWorktreeCandidate(
  plumbing: GitPlumbing,
  options: CommitWorktreeCandidateOptions,
): Promise<CommitWorktreeCandidateResult> {
  assertObjectId("baseObjectId", options.baseObjectId);

  const env = { ...CONTROL_CONTEXT_ENV, ...commitAuthorshipEnv(options.identity) };

  /** The worktree branch's current tip — `HEAD`, resolved out of real git rather than inferred. */
  const resolveTip = async (): Promise<string> => {
    const revParse = await plumbing.run(["rev-parse", "--verify", OPTION_TERMINATOR, "HEAD"], {
      cwd: options.worktreePath,
      env: CONTROL_CONTEXT_ENV,
    });
    return revParse.stdout.trim();
  };

  if (!(await isWorktreeDirty(plumbing, options.worktreePath))) {
    // Clean, but NOT necessarily unchanged — see ALREADY-COMMITTED WORK above.
    const tip = await resolveTip();
    return tip === options.baseObjectId
      ? { status: "nothing-to-commit" }
      : { status: "committed", objectId: tip };
  }

  /**
   * The exclusions are applied ONLY when the project does not already ignore
   * `node_modules`, because `git add` REFUSES a pathspec that explicitly names
   * an ignored path:
   *
   *     The following paths are ignored by one of your .gitignore files:
   *     node_modules
   *
   * Measured on run 4de72ba8 (2026-08-16), the first run whose worker actually
   * succeeded: collection aborted, and six minutes of real output was
   * discarded at the last step. Crabgic's own repository gitignores
   * `node_modules`, so every dogfooded run hit it.
   *
   * Probing rather than catching: `check-ignore` answers the exact question
   * ("does THIS worktree ignore it"), where swallowing the `add` failure would
   * also swallow the unrelated ones. When the path IS ignored the exclusions
   * are redundant — git already omits it — so dropping them changes nothing
   * about what gets committed, which the test asserts rather than assumes.
   */
  const ignoresNodeModules = await plumbing.run(
    ["check-ignore", "--quiet", OPTION_TERMINATOR, "node_modules"],
    { cwd: options.worktreePath, env: CONTROL_CONTEXT_ENV, allowFailure: true },
  );
  const excludes = ignoresNodeModules.exitCode === 0 ? [] : COLLECTION_EXCLUDE_PATHSPECS;

  await plumbing.run(["add", "--all", OPTION_TERMINATOR, ".", ...excludes], {
    cwd: options.worktreePath,
    env: CONTROL_CONTEXT_ENV,
  });

  // `--quiet` gives `--exit-code` semantics: 0 = index matches HEAD.
  const staged = await plumbing.run(["diff", "--cached", "--quiet"], {
    cwd: options.worktreePath,
    env: CONTROL_CONTEXT_ENV,
    allowFailure: true,
  });
  if (staged.exitCode === 0) {
    // Dirty, but nothing STAGED — the same two-claims distinction as the clean
    // arm above, so the tip is resolved here too rather than assumed.
    const tip = await resolveTip();
    return tip === options.baseObjectId
      ? { status: "nothing-to-commit" }
      : { status: "committed", objectId: tip };
  }

  // `--no-verify` and `--no-gpg-sign` are belt-and-suspenders beside
  // `CONTROL_CONTEXT_ENV`: the env neutralizes ambient hook/sign CONFIG, these
  // two neutralize a repo-local one the control clone could have inherited.
  await plumbing.run(
    [
      "commit",
      "--quiet",
      "--no-verify",
      "--no-gpg-sign",
      "-m",
      options.subject,
      "-m",
      options.body,
    ],
    { cwd: options.worktreePath, env },
  );

  return { status: "committed", objectId: await resolveTip() };
}

export interface BuildIntegrationCommitOptions {
  /** The control clone (owns the integration ref and both object ids). */
  readonly repoDir: string;
  /** `preflightMerge`'s own `treeId` — the merged tree, never re-derived here. */
  readonly treeId: string;
  /** The integration ref's CURRENT tip, which becomes this commit's only parent. */
  readonly parentObjectId: string;
  readonly subject: string;
  readonly body: string;
  readonly identity: GitIdentity;
}

/**
 * Wraps a preflighted tree as a commit on top of the integration tip, and
 * returns its object id — the `newValue` `applyCasUpdate` compare-and-swaps
 * onto the integration ref.
 *
 * Single-parent by construction, and that is the point: the parent is the
 * integration tip the tree was preflighted AGAINST, so the ref's history reads
 * as one commit per integrated work unit, in integration order.
 *
 * ARGV ORDERING NOTE (verified against real git 2.43.0, this change's own
 * probe): `git commit-tree` takes the tree as its LAST positional, so the
 * option terminator goes immediately before it — the same shape
 * `./publish-local.js`'s `rev-list … --not --end-of-options <excludes>` needed,
 * and for the same reason: a terminator placed before the `-p`/`-m` options
 * would make git read them as positionals. Both object ids are additionally
 * validated up front, so a flag-shaped value never reaches git at all.
 */
export async function buildIntegrationCommit(
  plumbing: GitPlumbing,
  options: BuildIntegrationCommitOptions,
): Promise<string> {
  assertObjectId("treeId", options.treeId);
  assertObjectId("parentObjectId", options.parentObjectId);

  const result = await plumbing.run(
    [
      "commit-tree",
      "-p",
      options.parentObjectId,
      "-m",
      options.subject,
      "-m",
      options.body,
      OPTION_TERMINATOR,
      options.treeId,
    ],
    {
      cwd: options.repoDir,
      env: { ...CONTROL_CONTEXT_ENV, ...commitAuthorshipEnv(options.identity) },
    },
  );
  return result.stdout.trim();
}

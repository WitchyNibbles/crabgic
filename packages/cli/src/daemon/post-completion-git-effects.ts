/**
 * The git half of the post-completion pipeline — collect, integrate, publish —
 * behind ONE injectable seam.
 *
 * SEAM BOUNDARY, AND WHY IT SITS EXACTLY HERE. This is the only part of the
 * post-completion walk a test may substitute. Everything above it —
 * `composeGateRegistry`, `fireFinalCandidateVerification`, and the
 * verdict → run-lifecycle mapping in `./post-completion-pipeline.ts` — is
 * production-only, with no option to override. A seam placed one level higher
 * would let a test hand the pipeline its own `GateRegistry` and go green while
 * production registered nothing, which is exactly the harness-only reach defect
 * `14-gate-registry-never-composed.md` documents. A seam placed one level lower
 * would force every dispatcher unit test that scripts a succeeding worker to
 * own a real repository. So: git effects injectable, gate firing never.
 *
 * WHAT THIS COMPOSES, all of it phase 08's own already-tested routines, none of
 * it reimplemented here:
 *
 *   - `commitWorktreeCandidate` — the collection step. A succeeded attempt
 *     leaves its worktree dirty by construction (no `git commit` is grantable
 *     to a worker), so there is no candidate to preflight until this runs.
 *   - `preflightMerge` against the ADVANCING integration tip, never the frozen
 *     base. Passing the frozen base is the vacuity `merge-preflight.ts`'s own
 *     2026-07-24 HIGH finding documents: every candidate descends from the base,
 *     so the merge would always be a trivial fast-forward and a real
 *     cross-unit conflict would be structurally undetectable. The tip is
 *     re-resolved from `applyCasUpdate`'s own result before every call.
 *   - `buildIntegrationCommit` + `applyCasUpdate` with a `rebuild` callback
 *     that re-preflights against the ref's actual tip — 08's documented
 *     bounded rebuild loop, every attempt journaled `cas_ref_update`.
 *   - `nameBranch` (derived and lint-passed, never a hand-written string) and
 *     `publishLocal` (the single write into user space: `git fetch
 *     <control-repo> <ref>:refs/heads/<branch>`, no checkout, no push).
 *
 * DEFERRED, WITH DISCLOSURE: phase 08's evidence-attachment routine
 * (`attachEvidence`, the `pr_title`/`pr_body`/`review_comment` handoff bundle)
 * does NOT ride here yet. It needs an `IdempotencyRegistry`, which the daemon's
 * dependency bundle does not carry, and it affects no run-lifecycle state — so
 * it is a separate composition step rather than a silent omission.
 *
 * KNOWN LIMITATION, DISCLOSED: a `WorkUnit.title` longer than the commit-subject
 * budget (`CommunicationPolicy.limits.commitSubject`, 72 chars including the
 * `<type>: ` prefix) makes `renderCommit` return `policy_blocked`, which this
 * surfaces as a `blocked` collection and the pipeline settles the run `blocked`.
 * That is 08's own `policy_blocked` terminal, reached honestly. Truncating the
 * outcome clause would be a change to 08's renderer contract, which this
 * composition has no authority to make.
 */
import {
  applyCasUpdate,
  buildIntegrationCommit,
  buildIntegrationRef,
  commitWorktreeCandidate,
  isBranchType,
  nameBranch,
  neutralCommitIdentity,
  preflightMerge,
  publishLocal,
  renderCommit,
  USER_CHECKOUT_READ_ENV,
  type BranchType,
  type GitPlumbing,
  type RenderCommitInput,
} from "@crabgic/git-engine";
import type { ChangeSet, Requirement, WorkUnit } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";

/** What one work unit's collected work is, once committed. `objectId` doubles as the `candidateRef` `preflightMerge` takes — an object id is a legal revision and `assertSafeRefPositional` accepts it. */
export type CollectCandidateResult =
  | { readonly status: "collected"; readonly objectId: string }
  /** The worker changed nothing committable — this unit's candidate is the tip it started from, so integration skips it. */
  | { readonly status: "nothing-to-commit" }
  /** 17's lint refused the rendered commit message (08's `policy_blocked` terminal). */
  | { readonly status: "blocked"; readonly reason: string };

export type BeginIntegrationResult =
  | { readonly status: "begun"; readonly ref: string; readonly tipObjectId: string }
  | { readonly status: "blocked"; readonly reason: string };

export type IntegrateCandidateResult =
  | { readonly status: "integrated"; readonly tipObjectId: string }
  /** Typed resolution `WorkUnit`s straight from `preflightMerge` — never auto-resolved. */
  | { readonly status: "conflict"; readonly resolutionUnits: readonly WorkUnit[] }
  | { readonly status: "blocked"; readonly reason: string };

export type PublishCandidateResult =
  | { readonly status: "published"; readonly branchName: string; readonly objectId: string }
  | { readonly status: "blocked"; readonly reason: string };

export interface PostCompletionGitEffects {
  /** Commits everything the worker left uncommitted in its own worktree. */
  collectCandidate(input: {
    readonly workUnit: WorkUnit;
    readonly changeSet: ChangeSet;
    readonly branchType: BranchType;
    readonly worktreePath: string;
  }): Promise<CollectCandidateResult>;
  /** Creates the run-scoped integration ref at the run's frozen base. */
  beginIntegration(input: {
    readonly runId: string;
    readonly changeSetId: string;
    readonly baseObjectId: string;
  }): Promise<BeginIntegrationResult>;
  /** Preflights one candidate against `tipObjectId`, commits the merged tree, and CAS-lands it. */
  integrateCandidate(input: {
    readonly ref: string;
    readonly tipObjectId: string;
    readonly candidateObjectId: string;
    readonly workUnit: WorkUnit;
    readonly changeSet: ChangeSet;
    readonly branchType: BranchType;
    readonly runId: string;
  }): Promise<IntegrateCandidateResult>;
  /** `git rev-parse` of the integration ref — the truly-integrated candidate object id a `GateContext` is fired against. */
  resolveIntegratedObjectId(input: { readonly ref: string }): Promise<string>;
  /** `nameBranch` + `publishLocal` into the user's own repository. */
  publishCandidate(input: {
    readonly ref: string;
    readonly branchType: BranchType;
    readonly slugSource: string;
  }): Promise<PublishCandidateResult>;
}

export interface RealPostCompletionGitEffectsOptions {
  readonly plumbing: GitPlumbing;
  /** 07's control clone — owns every candidate, the integration ref, and the fetch source. */
  readonly controlDir: string;
  /** The user's own checkout — the ONE place this writes into user space, and only a ref. */
  readonly projectDir: string;
  /** Committer/author email for supervisor-made commits; the name is always the neutral `Crabgic`. */
  readonly serviceEmail: string;
  readonly journal: JournalStore;
}

/**
 * The `BranchType` for a run's commits and its published branch, derived from
 * the contract rather than guessed.
 *
 * Precedence, and the reasoning for each step:
 *
 *  1. A `security`-section requirement wins outright, and a `performance` one
 *     next: both are `IntentContract` section keys AND members of 08's closed
 *     branch/commit type vocabulary, so this is a direct mapping rather than an
 *     interpretation.
 *  2. Otherwise a `WorkUnit.role` that happens to BE a branch type is used
 *     verbatim (`test`, `docs`, `refactor`, `ci`, `chore`, `fix`, `feat`). The
 *     role vocabulary is deliberately open (`@crabgic/contracts`' own note: "no
 *     closed role vocabulary is pinned anywhere"), so this is opportunistic and
 *     correct only when the two vocabularies coincide.
 *  3. Otherwise `chore` — the NEUTRAL claim. Defaulting to `feat` would have
 *     this composition assert something about the change that nothing in the
 *     `ChangeSet` expresses; `chore` understates rather than misstates. A richer
 *     derivation belongs to intake (11), which owns the planning outputs, and is
 *     named here rather than invented at a call site.
 */
export function deriveBranchType(
  requirements: readonly Requirement[],
  workUnits: readonly WorkUnit[],
): BranchType {
  if (requirements.some((requirement) => requirement.section === "security")) return "security";
  if (requirements.some((requirement) => requirement.section === "performance")) return "perf";
  for (const unit of workUnits) {
    if (isBranchType(unit.role)) return unit.role;
  }
  return "chore";
}

/**
 * The structured commit fields, assembled from already-produced
 * `WorkUnit`/`ChangeSet` values — never freshly authored prose, per roadmap/08
 * §In scope ("assembled from already-produced `ChangeSet`/`WorkUnit`/
 * `Requirement` fields (no free-text authorship)"). `verification` is the one
 * field that differs between the two commits a unit produces, because the two
 * genuinely were verified differently at the moment they were made.
 */
export function commitFieldsFor(input: {
  readonly workUnit: WorkUnit;
  readonly changeSet: ChangeSet;
  readonly branchType: BranchType;
  readonly stage: "collect" | "integrate";
}): RenderCommitInput {
  const declared = input.workUnit.requirementIds.length;
  return {
    type: input.branchType,
    outcome: input.workUnit.title,
    why: `role ${input.workUnit.role}, ${String(declared)} declared requirement(s)`,
    risk: `rollback: ${input.changeSet.rollbackStrategy}`,
    compat: `writes confined to ${input.workUnit.ownedPaths.join(", ")}`,
    verification:
      input.stage === "collect"
        ? "collected from the attempt worktree; gates fire at final_verifying"
        : "merge-tree preflighted against the integration tip, CAS-landed",
  };
}

/** `renderCommit`, with the `policy_blocked` outcome flattened into a reason string a lifecycle terminal can carry. */
async function renderOrBlock(
  fields: RenderCommitInput,
): Promise<
  | { readonly ok: true; readonly subject: string; readonly body: string }
  | { readonly ok: false; readonly reason: string }
> {
  const rendered = await renderCommit(fields);
  if (rendered.status === "blocked") {
    return {
      ok: false,
      reason:
        `the communication policy refused the rendered commit ${rendered.which} ` +
        `(${rendered.error}): ${rendered.findings.map((finding) => finding.message).join("; ")}`,
    };
  }
  return { ok: true, subject: rendered.subject, body: rendered.body };
}

export function createRealPostCompletionGitEffects(
  options: RealPostCompletionGitEffectsOptions,
): PostCompletionGitEffects {
  const { plumbing, controlDir, projectDir, journal } = options;
  const identity = neutralCommitIdentity(options.serviceEmail);

  /** Branch names already present in the user's repo, so `buildBranchNameCandidate` can apply its numeric collision suffix instead of `publishLocal` failing on a non-fast-forward fetch. */
  async function existingUserBranchNames(): Promise<readonly string[]> {
    const result = await plumbing.run(
      ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
      { cwd: projectDir, env: USER_CHECKOUT_READ_ENV, allowFailure: true },
    );
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async function integrationCommitFor(input: {
    readonly treeId: string;
    readonly parentObjectId: string;
    readonly workUnit: WorkUnit;
    readonly changeSet: ChangeSet;
    readonly branchType: BranchType;
  }): Promise<
    | { readonly ok: true; readonly objectId: string }
    | { readonly ok: false; readonly reason: string }
  > {
    const rendered = await renderOrBlock(
      commitFieldsFor({
        workUnit: input.workUnit,
        changeSet: input.changeSet,
        branchType: input.branchType,
        stage: "integrate",
      }),
    );
    if (!rendered.ok) return { ok: false, reason: rendered.reason };
    const objectId = await buildIntegrationCommit(plumbing, {
      repoDir: controlDir,
      treeId: input.treeId,
      parentObjectId: input.parentObjectId,
      subject: rendered.subject,
      body: rendered.body,
      identity,
    });
    return { ok: true, objectId };
  }

  return {
    async collectCandidate(input) {
      const rendered = await renderOrBlock(
        commitFieldsFor({
          workUnit: input.workUnit,
          changeSet: input.changeSet,
          branchType: input.branchType,
          stage: "collect",
        }),
      );
      if (!rendered.ok) return { status: "blocked", reason: rendered.reason };
      const committed = await commitWorktreeCandidate(plumbing, {
        worktreePath: input.worktreePath,
        subject: rendered.subject,
        body: rendered.body,
        identity,
      });
      if (committed.status === "nothing-to-commit") return { status: "nothing-to-commit" };
      return { status: "collected", objectId: committed.objectId };
    },

    async beginIntegration(input) {
      const ref = buildIntegrationRef(input.runId);
      // `git update-ref <ref> <new> <all-zeros>` means "create only if absent".
      // The zero oid is sized from the base object id rather than hardcoded to
      // 40 hex zeros, so a sha256 control clone works too.
      const absent = "0".repeat(input.baseObjectId.length);
      const created = await applyCasUpdate(plumbing, {
        repoDir: controlDir,
        ref,
        expectedOldValue: absent,
        newValue: input.baseObjectId,
        journal,
        runId: input.runId,
        changeSetId: input.changeSetId,
      });
      if (created.status !== "applied") {
        // No `rebuild` is supplied, so the only way here is that the ref
        // already exists — a previous, interrupted pipeline for this same run.
        // Refusing is honest: restart-safe pipeline resume is deferred, and
        // silently reusing a half-integrated tip would publish work no gate
        // fired against.
        return {
          status: "blocked",
          reason:
            `the integration ref "${ref}" already exists — a previous pipeline for run ` +
            `"${input.runId}" was interrupted. Cancel the run and dispatch the change set again.`,
        };
      }
      return { status: "begun", ref, tipObjectId: input.baseObjectId };
    },

    async integrateCandidate(input) {
      const preflight = await preflightMerge(plumbing, {
        repoDir: controlDir,
        candidateRef: input.candidateObjectId,
        // The ADVANCING tip, never the frozen base — see the file-level note.
        integrationTipObjectId: input.tipObjectId,
        changeSetId: input.changeSet.id,
      });
      if (!preflight.ok) return { status: "conflict", resolutionUnits: preflight.conflicts };

      const built = await integrationCommitFor({
        treeId: preflight.treeId,
        parentObjectId: input.tipObjectId,
        workUnit: input.workUnit,
        changeSet: input.changeSet,
        branchType: input.branchType,
      });
      if (!built.ok) return { status: "blocked", reason: built.reason };

      let rebuildConflict: readonly WorkUnit[] | undefined;
      const applied = await applyCasUpdate(plumbing, {
        repoDir: controlDir,
        ref: input.ref,
        expectedOldValue: input.tipObjectId,
        newValue: built.objectId,
        journal,
        runId: input.runId,
        changeSetId: input.changeSet.id,
        workUnitId: input.workUnit.id,
        // 08's documented rebuild pattern: re-preflight against the ref's ACTUAL
        // tip and re-commit onto it, so a lost race converges instead of
        // overwriting somebody else's landed work.
        rebuild: async (currentRefValue) => {
          const repreflight = await preflightMerge(plumbing, {
            repoDir: controlDir,
            candidateRef: input.candidateObjectId,
            integrationTipObjectId: currentRefValue,
            changeSetId: input.changeSet.id,
          });
          if (!repreflight.ok) {
            rebuildConflict = repreflight.conflicts;
            return {
              blocked: true,
              reason: `rebuild against ${currentRefValue} conflicts in ${String(repreflight.conflicts.length)} path(s)`,
            };
          }
          const rebuilt = await integrationCommitFor({
            treeId: repreflight.treeId,
            parentObjectId: currentRefValue,
            workUnit: input.workUnit,
            changeSet: input.changeSet,
            branchType: input.branchType,
          });
          if (!rebuilt.ok) return { blocked: true, reason: rebuilt.reason };
          return { newValue: rebuilt.objectId };
        },
      });
      if (applied.status !== "applied") {
        // A conflict discovered during the rebuild is still a CONFLICT, not an
        // opaque block: the resolution units are what an operator needs.
        if (rebuildConflict !== undefined) {
          return { status: "conflict", resolutionUnits: rebuildConflict };
        }
        return { status: "blocked", reason: applied.reason };
      }
      return { status: "integrated", tipObjectId: applied.objectId };
    },

    async resolveIntegratedObjectId(input) {
      const result = await plumbing.run(["rev-parse", "--verify", input.ref], {
        cwd: controlDir,
      });
      return result.stdout.trim();
    },

    async publishCandidate(input) {
      const named = await nameBranch({
        type: input.branchType,
        slugSource: input.slugSource,
        existingBranchNames: await existingUserBranchNames(),
      });
      if (named.status !== "named") {
        return {
          status: "blocked",
          reason:
            `the communication policy refused the derived branch name (${named.error}): ` +
            named.findings.map((finding) => finding.message).join("; "),
        };
      }
      const published = await publishLocal(plumbing, {
        userRepoPath: projectDir,
        controlRepoPath: controlDir,
        sourceRef: input.ref,
        branchName: named.branchName,
      });
      if (published.status !== "published") {
        return { status: "blocked", reason: published.reason };
      }
      return {
        status: "published",
        branchName: published.branchName,
        objectId: published.objectId,
      };
    },
  };
}

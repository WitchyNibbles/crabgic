/**
 * The post-completion pipeline — the walk from a completed drive to a published
 * local branch: `running → verifying → integrating → final_verifying →
 * published_local`.
 *
 * WHY THIS FILE EXISTS. Until now nothing in this repository — production code
 * or test — ever transitioned a run onto `verifying`, `integrating` or
 * `final_verifying`, so **no run had ever reached `published_local`**: crabgic
 * could not produce its own terminal artifact. `terminalStateFor("completed")`
 * in `./run-dispatcher.ts` deliberately returned `undefined` and said so —
 * `verifying` is "owned by the verification pipeline rather than invented here".
 * This is that pipeline. Defect record:
 * `docs/evidence/criteria-closeout/defects/14-gate-registry-never-composed.md`.
 *
 * WHY IT CANNOT STOP EARLIER THAN `published_local`. `verifying`, `integrating`
 * and `final_verifying` are all NON-absorbing
 * (`@crabgic/contracts`' `run-lifecycle.ts`), and
 * `findLiveRunForChangeSet` treats every non-absorbing run as in-flight — so a
 * run parked in any of them blocks its change set forever, which is exactly the
 * idle-run wedge `./run-dispatcher.ts`'s own history documents. A pipeline that
 * enters `verifying` must reach `published_local` or settle a terminal. There is
 * no honest resting point in between.
 *
 * THE SEAM RULE THIS FILE ENFORCES. `deps.git` is injectable
 * (`./post-completion-git-effects.ts`). `deps.registry`, the
 * `fireFinalCandidateVerification` call, and the verdict → run-lifecycle mapping
 * are NOT, and must never become so: a seam above the firing lets a test supply
 * its own `GateRegistry` and go green while production registers nothing, which
 * is the harness-only vacuity the defect record exists to catch.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, each disclosed and each pinned by an
 * assertion somewhere rather than only by this comment:
 *
 *  - **No per-unit `verifying`-stage firings.** The stage is now real, but no
 *    per-unit handler is registered — their inputs (coverage reports,
 *    digest-pinned scanners, engine-live records) are not composed. See
 *    `./compose-gate-registry.ts`, whose `COMPOSED_GATE_NAMES` is deep-equality
 *    asserted so a registration cannot land silently.
 *  - **No conflict-resolution dispatch.** A preflight conflict journals the
 *    typed resolution `WorkUnit`s and settles the run `blocked` on the declared
 *    `integrating → blocked` edge. Automatically re-dispatching them is 13's
 *    repair-loop territory.
 *  - **No restart-safe resume.** The pipeline runs same-daemon, inside
 *    `beginDriving`'s settle chain, using the in-process retained worktree
 *    paths. A daemon crash mid-pipeline leaves the run in one of the three
 *    pipeline states, and `./run-dispatcher.ts`'s `resume` answers that with a
 *    refusal that names the exit rather than reporting `accepted: true` to a
 *    re-drive that cannot advance it.
 *  - **`final_verifying` is fired IN-PROCESS, not as its own `TaskPacket`.**
 *    This is a disclosed DEVIATION from roadmap/14 work item 6's prose
 *    ("dispatched as its own `TaskPacket` through 13's executor"), and the
 *    reasoning belongs here, at the call site, rather than only in a PR body.
 *    `fireFinalCandidateVerification` frames itself as "the pure verification
 *    primitive whatever wraps it as a `TaskPacket`'s work invokes", and the ONE
 *    gate registered today is a pure journal + registry read: no subprocess, no
 *    measurement, no engine, nothing a worker sandbox would contain. The
 *    deviation is therefore safe for this gate and ONLY this gate — the
 *    `TaskPacket` dispatch is a precondition for registering any gate that
 *    executes stack commands (tests, scanners, benchmarks), and that is named
 *    in `./compose-gate-registry.ts` beside every unregistered handler.
 *
 * WHERE A GATE'S `detail` GOES, and why not the journal. `EvidenceRecord` (02)
 * has no `detail` member, so the journal carries the identifying tuple — gate
 * tag, typed `gateVerdict`, exit status, and the exact integrated `objectId` —
 * while the handler's own free-form `detail` rides the operator-facing error
 * channel (`onDriveError`). That split is deliberate: a gate's `detail` is
 * unbounded, gate-authored text, and a future security scanner's raw findings
 * could carry the very secret material a scan just found. Copying it into the
 * append-only, tamper-evident journal would make that permanent.
 */
import { IllegalTransitionError } from "@crabgic/contracts";
import type { ChangeSet, Requirement, WorkUnit, WorkUnitAttemptStatus } from "@crabgic/contracts";
import {
  allGatesPassed,
  fireFinalCandidateVerification,
  type GateFireResult,
  type GateRegistry,
} from "@crabgic/gates";
import type { JournalStore } from "@crabgic/journal";
import {
  resolveRequirementsStrict,
  transitionRun,
  type Registry,
  type RunsRegistry,
} from "@crabgic/supervisor";
import { changeSetRequirementIds } from "./compose-gate-registry.js";
import { deriveBranchType, type PostCompletionGitEffects } from "./post-completion-git-effects.js";

/**
 * Internal checkpoints, exposed as a test-only observer seam — the same
 * `onStep` pattern `@crabgic/git-engine`'s `createWorktree`/`ensureControlClone`
 * already use for their crash tests.
 *
 * An OBSERVER, deliberately, not an override: it cannot substitute a registry,
 * skip a firing or change a verdict. It exists so a test can make something
 * happen mid-pipeline — a post-approval criteria edit landing AFTER every unit's
 * own completion check has already passed, which is the one window only the
 * whole-set gate at `final_verifying` can see.
 */
export const POST_COMPLETION_STEPS = [
  "before-verifying",
  "after-collect",
  "before-final-verifying",
  "after-gates",
  "before-published-local",
] as const;
export type PostCompletionStep = (typeof POST_COMPLETION_STEPS)[number];

export interface PostCompletionPipelineInput {
  readonly runId: string;
  readonly changeSet: ChangeSet;
  readonly workUnits: readonly WorkUnit[];
  /** The run's ONE frozen base (07's intake freeze) — where the integration ref starts. */
  readonly baseObjectId: string;
  /** The drive's own per-unit verdict; only `succeeded` units contribute a candidate. */
  readonly statusById: ReadonlyMap<string, WorkUnitAttemptStatus>;
  /** Each unit's attempt worktree, from the dispatcher's retained per-run map — which is why this must run BEFORE `clearRetainedRun`. */
  readonly worktreePathByUnitId: ReadonlyMap<string, string>;
}

export interface PostCompletionPipelineDeps {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly requirements: Registry<Requirement>;
  readonly workUnitRegistry: Pick<Registry<WorkUnit>, "query">;
  /** NOT injectable from outside the dispatcher — see the file-level seam rule. */
  readonly registry: GateRegistry;
  readonly git: PostCompletionGitEffects;
  readonly onStep?: (step: PostCompletionStep) => void | Promise<void>;
}

export type PostCompletionOutcome =
  | { readonly status: "published"; readonly branchName: string; readonly objectId: string }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "blocked"; readonly reason: string }
  /** A `run.cancel` (or a drain) reached an absorbing state first — the pipeline stands down without writing over it. */
  | { readonly status: "raced"; readonly reason: string };

/**
 * The order candidates integrate in.
 *
 * `ChangeSet.integrationOrder` is 11's own planning output (a topological sort
 * of the DAG) and is authoritative. A succeeded unit MISSING from it — a
 * hand-built ChangeSet, or one amended after planning — is appended in stable
 * id order rather than dropped: dropping it would publish a candidate that
 * silently omits work the run reported as succeeded, which is worse than
 * integrating it in a less-informed position.
 */
export function integrationOrderFor(
  changeSet: ChangeSet,
  workUnits: readonly WorkUnit[],
): readonly WorkUnit[] {
  const byId = new Map(workUnits.map((unit) => [unit.id, unit]));
  const ordered: WorkUnit[] = [];
  const seen = new Set<string>();
  for (const id of changeSet.integrationOrder) {
    const unit = byId.get(id);
    if (unit === undefined || seen.has(id)) continue;
    seen.add(id);
    ordered.push(unit);
  }
  const remaining = [...workUnits].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const unit of remaining) {
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    ordered.push(unit);
  }
  return ordered;
}

/** A gate failure, rendered for the operator-facing channel: which gate, under which tag, with its own `detail`. */
function describeGateFailures(results: readonly GateFireResult[]): string {
  return results
    .filter((result) => !result.verdict.passed)
    .map(
      (result) =>
        `${result.name} (${result.tag}) exit ${String(result.verdict.exitStatus)}: ${result.verdict.detail}`,
    )
    .join(" | ");
}

export async function runPostCompletionPipeline(
  input: PostCompletionPipelineInput,
  deps: PostCompletionPipelineDeps,
): Promise<PostCompletionOutcome> {
  const changeSetId = input.changeSet.id;

  /**
   * One transition, through the SAME production surface `createRun` and
   * `run.cancel` use — never a second transition table (`run-transition.ts`'s
   * own header forbids one). `false` means an absorbing state won the race
   * (`run.cancel`, or `drain`'s cut-off), in which case the pipeline stands
   * down rather than fighting it.
   */
  async function transition(to: Parameters<typeof transitionRun>[0]["to"]): Promise<boolean> {
    try {
      await transitionRun({
        journal: deps.journal,
        runs: deps.runs,
        runId: input.runId,
        changeSetId,
        to,
      });
      return true;
    } catch (err) {
      if (err instanceof IllegalTransitionError) return false;
      throw err;
    }
  }

  const raced = (where: string): PostCompletionOutcome => ({
    status: "raced",
    reason: `run "${input.runId}" reached an absorbing state before the pipeline could ${where}`,
  });

  await deps.onStep?.("before-verifying");
  if (!(await transition("verifying"))) return raced("begin verification");

  // The whole ChangeSet's requirement set, resolved through the SAME id union
  // and the SAME strict resolver the seal gate uses — so the branch/commit type
  // and the gate can never disagree about what this run's bar is.
  //
  // FAIL CLOSED HERE TOO, and not by relying on the caller's `.catch`.
  // `resolveRequirementsStrict` throws `UnresolvedRequirementError` for a
  // declared id with no record — the run-level, INPUTS-incoherent refusal ruled
  // on 2026-08-04. Letting it escape would leave the run sitting in `verifying`
  // for however long it took the dispatcher's own error path to settle it, and
  // `verifying` is non-absorbing: the change set would be un-dispatchable in the
  // meantime. The pipeline owns its terminals, including this one.
  let requirements: readonly Requirement[];
  try {
    requirements = resolveRequirementsStrict(
      deps.requirements,
      changeSetRequirementIds(deps.workUnitRegistry, changeSetId),
      changeSetId,
    );
  } catch (err) {
    await transition("failed");
    return {
      status: "failed",
      reason: `the run's acceptance basis could not be resolved: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  const ordered = integrationOrderFor(input.changeSet, input.workUnits);
  const branchType = deriveBranchType(requirements, ordered);

  // COLLECT (still `verifying`): a succeeded attempt's worktree is dirty by
  // construction — no `git commit` is grantable to a worker — so nothing is
  // integrable until this runs.
  const candidates: { readonly workUnit: WorkUnit; readonly objectId: string }[] = [];
  for (const workUnit of ordered) {
    if (input.statusById.get(workUnit.id) !== "succeeded") continue;
    const worktreePath = input.worktreePathByUnitId.get(workUnit.id);
    if (worktreePath === undefined) {
      // The run reported this unit succeeded but this daemon no longer holds
      // its worktree (a re-drive after a restart seeded the status from the
      // journal). Publishing without its work would silently ship an
      // incomplete candidate.
      await transition("failed");
      return {
        status: "failed",
        reason:
          `work unit "${workUnit.id}" succeeded but its attempt worktree is not retained by this ` +
          `daemon, so its work cannot be collected. Cancel the run and dispatch the change set again.`,
      };
    }
    const collected = await deps.git.collectCandidate({
      workUnit,
      changeSet: input.changeSet,
      branchType,
      worktreePath,
      baseObjectId: input.baseObjectId,
    });
    if (collected.status === "blocked") {
      await transition("blocked");
      return {
        status: "blocked",
        reason: `collecting work unit "${workUnit.id}" was blocked: ${collected.reason}`,
      };
    }
    if (collected.status === "nothing-to-commit") continue;
    candidates.push({ workUnit, objectId: collected.objectId });
  }
  await deps.onStep?.("after-collect");

  if (!(await transition("integrating"))) return raced("begin integration");

  const begun = await deps.git.beginIntegration({
    runId: input.runId,
    changeSetId,
    baseObjectId: input.baseObjectId,
  });
  if (begun.status !== "begun") {
    await transition("blocked");
    return { status: "blocked", reason: begun.reason };
  }

  let tipObjectId = begun.tipObjectId;
  for (const candidate of candidates) {
    const integrated = await deps.git.integrateCandidate({
      ref: begun.ref,
      // The ADVANCING tip. Passing the frozen base here is the documented
      // vacuity: every candidate descends from it, so every merge would be a
      // trivial fast-forward and a real cross-unit conflict would be
      // undetectable.
      tipObjectId,
      candidateObjectId: candidate.objectId,
      workUnit: candidate.workUnit,
      changeSet: input.changeSet,
      branchType,
      runId: input.runId,
    });
    if (integrated.status === "conflict") {
      // The typed resolution `WorkUnit`s are `preflightMerge`'s own output, never
      // auto-resolved. Journaled so an operator can see WHICH paths conflicted
      // and under which ids; NOT written into the work-unit registry, because
      // that would make them dispatchable and automatic re-dispatch is 13's
      // repair loop, deliberately deferred.
      //
      // `adjudication_decision` with a namespaced discriminator and the record
      // JSON-encoded in `rationale` is the shape phase 14 established and
      // interface-ledger Gap 5's 2026-08-01 resolution ratified for exactly this
      // case — no 14th `JournalEntryType`. The payload is ids, roles and
      // repository paths only: no worker-authored text.
      await deps.journal.appendEntry({
        type: "adjudication_decision",
        runId: input.runId,
        changeSetId,
        payload: {
          decision: "integration_conflict",
          subjectId: changeSetId,
          rationale: JSON.stringify({
            workUnitId: candidate.workUnit.id,
            resolutionWorkUnits: integrated.resolutionUnits.map((unit) => ({
              id: unit.id,
              role: unit.role,
              ownedPaths: [...unit.ownedPaths],
            })),
          }),
        },
      });
      await transition("blocked");
      const paths = integrated.resolutionUnits.flatMap((unit) => unit.ownedPaths);
      return {
        status: "blocked",
        reason:
          `integrating work unit "${candidate.workUnit.id}" conflicts in ${paths.join(", ")}. ` +
          `${String(integrated.resolutionUnits.length)} resolution work unit(s) were journaled; ` +
          `resolve them, then cancel the run and dispatch the change set again.`,
      };
    }
    if (integrated.status === "blocked") {
      await transition("blocked");
      return {
        status: "blocked",
        reason: `integrating work unit "${candidate.workUnit.id}" was blocked: ${integrated.reason}`,
      };
    }
    tipObjectId = integrated.tipObjectId;
  }

  if (!(await transition("final_verifying"))) return raced("begin final verification");
  await deps.onStep?.("before-final-verifying");

  // THE INTEGRATED CANDIDATE OBJECT ID — re-resolved from the ref itself rather
  // than carried forward from the loop above, so the value a `GateContext` is
  // fired against is what the ref actually holds. Never a cached per-unit value:
  // that is roadmap/14's own "final-candidate re-verification never trusts a
  // cached per-work-unit result".
  const objectId = await deps.git.resolveIntegratedObjectId({ ref: begun.ref });

  let results: readonly GateFireResult[];
  try {
    results = await fireFinalCandidateVerification(deps.registry, {
      stage: "final_verifying",
      changeSetId,
      objectId,
      journal: deps.journal,
    });
  } catch (err) {
    // FAIL CLOSED. Two live throws reach here and both mean the run's own
    // verification basis is unusable, not that a candidate is bad:
    // `NoGatesRegisteredError` (an empty/mis-wired registry — `fireAll([])`
    // would otherwise be vacuously green) and `UnresolvedRequirementError` (a
    // declared requirement id with no record, i.e. an INPUTS-incoherent
    // acceptance basis — the 2026-08-04 run-level ruling recorded in
    // `./run-dispatcher.ts`). Either way the run fails; nothing publishes.
    await transition("failed");
    return {
      status: "failed",
      reason: `final-candidate verification could not run against ${objectId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  await deps.onStep?.("after-gates");

  if (!allGatesPassed(results)) {
    await transition("failed");
    return {
      status: "failed",
      reason: `final-candidate verification refused ${objectId}: ${describeGateFailures(results)}`,
    };
  }

  const slugSource = ordered[0]?.title ?? input.changeSet.rollbackStrategy;
  const published = await deps.git.publishCandidate({
    ref: begun.ref,
    branchType,
    slugSource,
  });
  if (published.status !== "published") {
    await transition("failed");
    return { status: "failed", reason: `publication was blocked: ${published.reason}` };
  }

  // THE WALK'S CENTRAL BINDING, ENFORCED IN PRODUCTION AND NOT ONLY IN A TEST.
  //
  // Everything above is worth exactly this much: the artifact that reached the
  // user's repository must be the artifact the gates verified. `objectId` is
  // what `fireFinalCandidateVerification` was fired against and what every
  // `EvidenceRecord` from that firing is hash-bound to; `published.objectId` is
  // `publishLocal`'s own `rev-parse` of the new branch in the USER's repo — a
  // different repository, resolved independently. Under correct operation they
  // are necessarily equal (the integration ref is run-scoped and this pipeline
  // is the only writer, sequentially). A divergence therefore means the
  // published tree is NOT the verified one, which is the one outcome this whole
  // change exists to make impossible.
  //
  // FAIL CLOSED, AND RETRACT. The branch is deleted before the run is failed —
  // the same posture `publishLocal` applies to its own attribution re-check,
  // which removes the ref rather than leaving a tainted branch behind. Failing
  // without retracting would leave an unverified branch sitting in the user's
  // repo, which is worse than not publishing at all.
  //
  // This is what makes the binding an enforced invariant rather than a claim
  // three assertions in one file happen to check: mutating the id the gate
  // fires against is now refused by the code, not merely caught by a test.
  if (published.objectId !== objectId) {
    await deps.git.retractPublishedBranch({ branchName: published.branchName });
    await transition("failed");
    return {
      status: "failed",
      reason:
        `the published branch "${published.branchName}" resolved to ${published.objectId}, which is ` +
        `NOT the candidate final verification passed (${objectId}) — the branch has been retracted ` +
        `and the run failed rather than leave an unverified artifact published.`,
    };
  }

  await deps.onStep?.("before-published-local");
  if (!(await transition("published_local"))) return raced("record publication");
  return { status: "published", branchName: published.branchName, objectId: published.objectId };
}

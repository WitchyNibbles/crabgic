/**
 * The REAL `RunDispatcher` — the production caller `driveRun` never had.
 *
 * roadmap/13 §Goal: "the DAG approved in 11 executes to completion without
 * further human intervention." Every ingredient existed and was tested in
 * isolation; this module is the composition that finally connects them:
 *
 *   run.dispatch (05's router)
 *     -> this dispatcher
 *       -> freezeIntake (07)            — the frozen base object id
 *       -> driveRun (13)                — the readiness/fan-out loop
 *         -> createWorktree (07)        — one isolated worktree per attempt
 *         -> provisionWorkerDirs (05)   — 0700 HOME/TMP/CLAUDE_CONFIG_DIR
 *         -> ClaudeEngineAdapter (06)   — the real engine
 *         -> compileEnvelope (03)       — the compiled worker profile
 *         -> buildTaskPacket (13)       — bounded, envelope-scoped work
 *
 * It lives in `packages/cli` rather than `@crabgic/supervisor` for the same
 * reason the daemon entry point does: it needs `@crabgic/engine-claude`, which
 * already depends on `@crabgic/supervisor`, so composing it there would be a
 * dependency cycle. `@crabgic/supervisor` declares only the interface
 * (`router/run-dispatcher.ts`) and the daemon injects this implementation.
 *
 * OWNERSHIP, NOT COMPLETION: `dispatch()` resolves as soon as it has
 * decided whether to take the run — the drive itself continues in the
 * background. A run can take hours, and `status`/`cancel` are exactly what
 * an operator reaches for while one is in flight; awaiting the run here
 * would hold the UDS request (and the control socket) open for its whole
 * duration. `inFlight` makes dispatch idempotent per run, so a second
 * `run.dispatch` never starts a competing driver over the same work units.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isRunLifecycleAbsorbing, IllegalTransitionError } from "@crabgic/contracts";
import type { RunLifecycleState } from "@crabgic/contracts";
import type {
  AuthorizationEnvelope,
  ChangeSet,
  EnvelopePolicy,
  WorkUnit,
} from "@crabgic/contracts";
import type { XdgEnv } from "@crabgic/journal";
import type { JournalStore } from "@crabgic/journal";
import {
  createRun,
  findLiveRunForChangeSet,
  findPublishedRunForChangeSet,
  provisionWorkerDirs,
  transitionRun,
  type RunDispatcher,
  type RunDispatchOutcome,
  type SupervisorDependencies,
  type TerminableWorker,
} from "@crabgic/supervisor";
import {
  createGitPlumbing,
  createNodeGitSpawn,
  createWorktree,
  provisionWorktreeDependencies,
  ensureControlClone,
  freezeIntake,
  resolveGitControlDir,
  resolveWorktreesRootDir,
  type GitPlumbing,
} from "@crabgic/git-engine";
import { compileEnvelope, isContained } from "@crabgic/engine-core";
import type { AdjudicationCallback, EngineAdapter, SessionRef } from "@crabgic/engine-core";
import {
  ClaudeEngineAdapter,
  createSessionRef,
  type WorkerAuthMaterial,
} from "@crabgic/engine-claude";
import {
  buildTaskPacket,
  driveRun,
  resumeAttempt,
  type DispatchAttemptOutcome,
  type DriveRunResult,
  type WorkerDispatchContext,
} from "@crabgic/scheduler";
import type { LoadPolicyResult } from "../policy/policy-store.js";

/** Git identity for worktree commits. `@crabgic/git-engine` deliberately leaves resolving this to its caller (see `configureGitIdentity`'s own doc comment). */
const DEFAULT_SERVICE_EMAIL = "crabgic@localhost";

/** The ref a run is based on when the caller names none. */
const DEFAULT_TARGET_REF = "HEAD";

// The per-attempt engine turn cap comes from the AUTHORIZED envelope's own
// `maxTurnsPerAttempt` (tested for policy containment like every other
// authority dimension) — this module deliberately has no turn constant of its
// own. The hardcoded 40 that used to live here was an authority nothing
// governed.

/**
 * The result shape every worker must return. Deliberately minimal and
 * stable: 13's `validateWorkerResult` is what enforces it against the
 * structured output a worker actually produces.
 */
const WORKER_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["succeeded", "failed"] },
    summary: { type: "string" },
  },
  required: ["outcome"],
};

/**
 * Refuses every adjudication by default. roadmap/05 owns the real
 * adjudication bus; until one is attached, a daemon running unattended must
 * fail closed — an auto-approved escalation is exactly what the
 * human-in-the-loop gates exist to prevent.
 */
const REFUSE_ALL_ADJUDICATIONS: AdjudicationCallback = () =>
  Promise.resolve({
    behavior: "deny",
    message: "no adjudicator is attached to this daemon; failing closed",
  });

export interface RealRunDispatcherOptions {
  /** The SAME dependency bundle the router serves — the driver must register into the identical `liveWorkers` map `worker.terminate` reads. */
  readonly deps: SupervisorDependencies & { readonly liveWorkers: Map<string, TerminableWorker> };
  /** The repository checkout to freeze and cut worktrees from (`CRABGIC_PROJECT_DIR`). */
  readonly projectDir: string;
  readonly xdgEnv: XdgEnv;
  readonly projectHash: string;
  /** Engine credentials for every spawned worker, resolved per docs/engine-baseline.md §1's order. */
  readonly auth: WorkerAuthMaterial;
  readonly serviceEmail?: string;
  readonly targetRef?: string;
  /** Adjudication bus (05). Defaults to refusing every escalation. */
  readonly adjudicate?: AdjudicationCallback;
  /**
   * Seam: prepares the repository for a run and yields the frozen base
   * object id. Defaults to control-clone + `freezeIntake` (07). Injected in
   * tests so no real repository is cloned or frozen.
   */
  readonly prepareRun?: (runId: string, changeSet: ChangeSet) => Promise<string>;
  /**
   * Seam: creates the isolated worktree for one attempt and yields its
   * path. Defaults to `createWorktree` (07). Injected in tests so no real
   * `git worktree add` runs.
   */
  readonly createAttemptWorktree?: (
    ctx: WorkerDispatchContext,
    baseObjectId: string,
  ) => Promise<string>;
  /** Seam: builds the engine adapter for one attempt. Overridden in tests so no real engine process is started. */
  readonly createAdapter?: (
    ctx: WorkerDispatchContext,
    worktreePath: string,
    journal: JournalStore,
  ) => Promise<EngineAdapter>;
  /** Seam: git plumbing. Overridden in tests so no real repository is touched. */
  readonly plumbing?: GitPlumbing;
  /** Reports a background drive that ended in an error. Defaults to a no-op; the daemon supplies real logging. */
  readonly onDriveError?: (runId: string, err: unknown) => void;
  /**
   * Loads the project's standing `EnvelopePolicy` (ledger Gap 18).
   *
   * A seam so tests need no real XDG state, but NOT an optional gate: a
   * dispatcher with no loader, or a loader that finds no policy, refuses to
   * dispatch. It never falls back to compiling wide — that would turn the
   * absence of an approval into a broader grant than any approval could
   * express, which is the exact inversion this ruling exists to prevent.
   */
  readonly loadPolicy?: () => LoadPolicyResult;
  /**
   * Where the standing policy lives on disk, included in a containment
   * refusal so the remedy that WORKS is named at every gate. Review
   * (2026-07-30) traced the alternative: the intake escalation names the
   * path but the daemon refusal did not, and `crabgic approve` — the other
   * offered remedy — mints a token this gate never reads, so an owner
   * following the daemon's message had no path to edit and a ceremony that
   * cannot succeed.
   */
  readonly standingPolicyPath?: string;
}

type ResolvedRun =
  | {
      readonly ok: true;
      readonly changeSet: ChangeSet;
      readonly workUnits: readonly WorkUnit[];
      readonly envelope: AuthorizationEnvelope;
    }
  | { readonly ok: false; readonly reason: string };

type PolicyGate =
  | { readonly ok: true; readonly policy: EnvelopePolicy; readonly digest: string }
  | { readonly ok: false; readonly reason: string };

export function createRealRunDispatcher(options: RealRunDispatcherOptions): RunDispatcher {
  const { deps, projectDir, xdgEnv, projectHash } = options;
  const serviceEmail = options.serviceEmail ?? DEFAULT_SERVICE_EMAIL;
  const targetRef = options.targetRef ?? DEFAULT_TARGET_REF;
  const adjudicate = options.adjudicate ?? REFUSE_ALL_ADJUDICATIONS;
  const plumbing = options.plumbing ?? createGitPlumbing({ spawnFn: createNodeGitSpawn() });
  const onDriveError = options.onDriveError ?? ((): void => undefined);

  /**
   * Change sets this daemon is already driving — makes `dispatch` idempotent
   * per CHANGE SET rather than per run. It has to be: the caller no longer
   * supplies a runId, so keying on the run would mean minting one just to
   * discover it was a duplicate, journalling a run that should never have
   * existed.
   */
  const inFlight = new Set<string>();

  // NOTE: this dispatcher briefly constructed an in-memory attempt cache
  // (`AttemptCacheSeam`) so a same-daemon re-drive would reuse succeeded
  // attempts. `driveRun` now seeds each unit's status from the DURABLE
  // journal instead — a succeeded unit is never re-selected — which does the
  // same job restart-safely and without a second mechanism keyed on the
  // authorizing policy digest. The cache was removed rather than kept as
  // unreachable dead code (its review's F2). See `@crabgic/scheduler`'s
  // `driveRun` journal-seed.

  /**
   * The standing-approval gate: load the policy, then test the envelope for
   * containment in it.
   *
   * NO POLICY MEANS NO DISPATCH. Not "dispatch wide" -- an absent or
   * unreadable policy must never be a broader grant than any policy could
   * express, which is what falling back to the unnarrowed compile would make
   * it. Absent and invalid are reported differently because they are
   * different owner problems: one means `install` never ran, the other means
   * the file was hand-edited into a state the schema rejects.
   */
  function resolvePolicyGate(envelope: AuthorizationEnvelope): PolicyGate {
    if (options.loadPolicy === undefined) {
      return {
        ok: false,
        reason:
          "no standing EnvelopePolicy is configured on this daemon; run `crabgic install` to author one",
      };
    }

    const loaded = options.loadPolicy();
    if (loaded.status === "absent") {
      return {
        ok: false,
        reason:
          "this project has no standing EnvelopePolicy; run `crabgic install` to author one, then dispatch again",
      };
    }
    if (loaded.status === "invalid") {
      // A transient failure still REFUSES -- fail-closed is not negotiable at
      // this gate -- but it must not read like a broken policy. Round 9 found
      // exactly this mismatch in the doctor and fixed it there; the dispatch
      // gate is the second consumer and had the same gap.
      return {
        ok: false,
        reason:
          loaded.transient === true
            ? `${loaded.reason}; dispatch refused rather than run unauthorized — retry once resources free up`
            : loaded.reason,
      };
    }

    const containment = isContained(envelope, loaded.policy);
    if (!containment.contained) {
      // Every escaping dimension, not the first: the owner has to edit a file
      // this process cannot reach, so one refusal must tell them the whole
      // gap rather than making recovery an iterative guessing game — and
      // name the file, because editing it is the only remedy that works
      // (`crabgic approve` mints a token this gate never reads).
      const wherePolicy =
        options.standingPolicyPath === undefined
          ? ""
          : ` (the standing policy is at ${options.standingPolicyPath})`;
      return {
        ok: false,
        reason:
          `this change set needs authority the standing policy does not grant: ` +
          `${containment.reasons.join("; ")}${wherePolicy}`,
      };
    }

    return { ok: true, policy: loaded.policy, digest: loaded.digest };
  }

  /** Resolves everything a change set needs to run, or explains precisely what is missing. */
  function resolveChangeSet(changeSetId: string): ResolvedRun {
    const changeSet = deps.changeSets.get(changeSetId);
    if (changeSet === undefined) {
      return { ok: false, reason: `unknown change set "${changeSetId}"` };
    }

    const workUnits = deps.workUnits.query((unit) => unit.changeSetId === changeSet.id);
    if (workUnits.length === 0) {
      return { ok: false, reason: `change set "${changeSet.id}" has no work units to dispatch` };
    }

    // The envelope is the authorization boundary every packet is bounded
    // against — dispatching without it would mean dispatching unbounded.
    const envelope = deps.envelopes?.get(changeSet.authorizationEnvelopeId);
    if (envelope === undefined) {
      return {
        ok: false,
        reason: `authorization envelope "${changeSet.authorizationEnvelopeId}" is not available; refusing to dispatch unbounded work`,
      };
    }

    return { ok: true, changeSet, workUnits, envelope };
  }

  async function drive(
    runId: string,
    changeSet: ChangeSet,
    workUnits: readonly WorkUnit[],
    envelope: AuthorizationEnvelope,
    policy: EnvelopePolicy,
  ): Promise<DriveRunResult> {
    const controlDir = resolveGitControlDir(xdgEnv, projectHash);
    const worktreesRootDir = resolveWorktreesRootDir(xdgEnv, projectHash);

    // Per-unit adapters RETAINED for this drive's lifetime, so a
    // rate-limit-parked unit can be RESUMED (not re-dispatched — that would
    // count its original dispatch toward the repair budget and be refused).
    // A resume needs the SAME adapter instance that spawned the session: only
    // it holds that session's `{packet, profile}` context, so `adapter.resume`
    // continues with full authority instead of the read-only fallback a fresh
    // adapter gets (`docs/…` engine-baseline; adapter.ts's spawn-context
    // cache). The map lives only for this `drive()` call — a re-drive after a
    // daemon restart finds it empty and declines to resume (leaves the unit
    // parked), which is the ledger's separate restart-safe carry-forward.
    const retainedWorkers = new Map<
      string,
      { readonly adapter: EngineAdapter; readonly worktreePath: string; readonly configDir: string }
    >();

    // ONE freeze per run: every attempt is based on the same object id,
    // which is what makes a run's results comparable and its worktrees
    // mergeable against a single known base.
    const baseObjectId = await (
      options.prepareRun ??
      (async (): Promise<string> => {
        await ensureControlClone(plumbing, { controlDir, sourceRepoPath: projectDir });
        const frozen = await freezeIntake({
          plumbing,
          controlDir,
          userCheckoutPath: projectDir,
          targetRef,
          plannedWritePaths: [...envelope.ownedPaths],
          journal: deps.journal,
          runId,
          changeSetId: changeSet.id,
        });
        if (frozen.status !== "frozen") {
          throw new Error(
            `cannot dispatch run "${runId}": repository freeze was blocked by dirty paths (${frozen.offendingPaths.join(", ")})`,
          );
        }
        return frozen.freeze.baseObjectId;
      })
    )(runId, changeSet);

    // Compiled once: the profile is a pure function of the envelope, and
    // every worker in this run runs under the same authorization.
    const profile = compileEnvelope(envelope, policy);

    return await driveRun(
      { runId, changeSetId: changeSet.id, workUnits },
      {
        journal: deps.journal,
        liveWorkers: deps.liveWorkers,
        adjudicate,
        compileProfile: () => Promise.resolve(profile),
        buildPacket: (ctx) =>
          Promise.resolve(
            buildTaskPacket({
              id: randomUUID(),
              workUnitId: ctx.workUnit.id,
              requirementIds: [...ctx.workUnit.requirementIds],
              objective: ctx.workUnit.title,
              baseObjectId,
              ownedPaths: [...ctx.workUnit.ownedPaths],
              resourceLimits: { maxTurns: envelope.maxTurnsPerAttempt },
              resultSchema: WORKER_RESULT_SCHEMA,
              envelope,
            }).packet,
          ),
        createAdapter: async (ctx) => {
          const worktreePath =
            options.createAttemptWorktree !== undefined
              ? await options.createAttemptWorktree(ctx, baseObjectId)
              : await (async (): Promise<string> => {
                  const created = await createWorktree(plumbing, {
                    repoDir: controlDir,
                    worktreesRootDir,
                    runId,
                    changeSetId: changeSet.id,
                    taskId: ctx.workUnit.id,
                    baseObjectId,
                    serviceEmail,
                  });
                  // `git worktree add` leaves no `node_modules`, and
                  // `npm run test`/`npm run build` are two of only four
                  // grantable command prefixes -- so without this every
                  // attempt on a Node project fails at the build, not at a
                  // gate (roast round 1, F7). Dependencies are shared from
                  // the user's own checkout; a non-Node project provisions
                  // nothing and proceeds.
                  await provisionWorktreeDependencies({
                    worktreePath: created.worktreePath,
                    sourceDir: projectDir,
                  });
                  return created.worktreePath;
                })();
          // Provisioned uniformly (both the real and the test-injected adapter
          // path) so `configDir` is always known for a later resume's
          // SessionRef reconstruction — a `parkResume` scope-matches on the
          // worktree, and the config dir isolates the session's transcript.
          const provisioning = await provisionWorkerDirs(
            join(worktreesRootDir, "workers"),
            ctx.workUnit.id,
          );
          const adapter =
            options.createAdapter !== undefined
              ? await options.createAdapter(ctx, worktreePath, deps.journal)
              : new ClaudeEngineAdapter({
                  worktreePath,
                  provisioning,
                  auth: options.auth,
                  journal: deps.journal,
                  model: ctx.model,
                  runId,
                });
          retainedWorkers.set(ctx.workUnit.id, {
            adapter,
            worktreePath,
            configDir: provisioning.CLAUDE_CONFIG_DIR,
          });
          return adapter;
        },
        resumeParkedUnit: async (ctx, sessionId): Promise<DispatchAttemptOutcome | undefined> => {
          const retained = retainedWorkers.get(ctx.workUnit.id);
          // No retained adapter — a re-drive after a daemon restart lost it.
          // Decline rather than resume into a read-only fallback session that
          // could not complete the work; the driver leaves the unit parked.
          if (retained === undefined) return undefined;
          // Reconstruct the SessionRef the adapter spawned this session with:
          // `createSessionRef` sets `projectDirectory` to the worktree path,
          // and the resume scope-check compares exactly those two — so the
          // retained worktree + the journaled sessionId identify the session.
          const sessionRef: SessionRef = createSessionRef({
            sessionId,
            worktreePath: retained.worktreePath,
            configDir: retained.configDir,
          });
          return resumeAttempt({
            adapter: retained.adapter,
            journal: deps.journal,
            sessionRef,
            workUnitId: ctx.workUnit.id,
            adjudicate,
            trigger: { kind: "parkResume" },
            runId,
          });
        },
      },
    );
  }

  /**
   * The run-lifecycle state a settled drive moves the run to, or `undefined`
   * to leave it `running` (ledger run-lifecycle: `running →
   * verifying|failed|blocked|cancelled`).
   *
   * Only the FAILURE outcomes transition, and this is deliberate: a run that
   * ended `blocked` or errored used to stay `running` forever, and
   * `findLiveRunForChangeSet` treats `running` as in-flight — so the change
   * set could never be re-dispatched, the exact retry-blocking harm this
   * fixes (review F5). `completed` and `parked` stay `running`: a completed
   * DAG's successor is `verifying`, owned by the verification pipeline (not
   * yet wired) rather than invented here, and a completed run must not be
   * retried anyway; a parked run is resumable and must stay in-flight for
   * `resume` to reach it.
   */
  function terminalStateFor(stopped: DriveRunResult["stopped"]): RunLifecycleState | undefined {
    switch (stopped) {
      case "blocked":
        return "blocked";
      case "roundLimit":
        // The round backstop tripped — a bug, not a normal outcome; fail it
        // so the change set can be retried rather than wedged `running`.
        return "failed";
      case "completed":
      case "parked":
        return undefined;
      default: {
        // Exhaustiveness guard: a new `DriveRunStopReason` must be classified
        // here deliberately, not silently left `running`.
        const _exhaustive: never = stopped;
        return _exhaustive;
      }
    }
  }

  /**
   * Moves a settled/errored run to its terminal state. NEVER rejects — this
   * runs on the not-awaited drive chain, so an error escaping here would be
   * an unhandled rejection, the exact daemon-crash this whole path is
   * structured to prevent.
   *
   * Two failure modes, both handled: an `IllegalTransitionError` means the
   * run already reached an absorbing state independently — a `run.cancel`
   * racing the drive leaves it `cancelled`, so `running → failed` is an
   * illegal edge — which is EXPECTED and silently ignored. Any other error
   * (a journal-write failure) is a genuine but background problem: report it
   * through `onDriveError` rather than let it propagate.
   */
  async function settleRunState(
    runId: string,
    changeSetId: string,
    to: RunLifecycleState,
  ): Promise<void> {
    try {
      await transitionRun({ journal: deps.journal, runs: deps.runs, runId, changeSetId, to });
    } catch (err) {
      if (err instanceof IllegalTransitionError) return;
      onDriveError(runId, err);
    }
  }

  /**
   * Hands the resolved DAG to the driver in the background and reports
   * ownership immediately. Shared by `dispatch` and `resume` so the
   * not-awaited discipline, the error routing and the in-flight bookkeeping
   * have exactly one definition.
   */
  function beginDriving(
    runId: string,
    resolved: Extract<ResolvedRun, { ok: true }>,
    policy: EnvelopePolicy,
    /** Releases the caller's in-flight claim. Called exactly once, when the drive settles. */
    release: () => void,
  ): void {
    const changeSetId = resolved.changeSet.id;
    // Deliberately NOT awaited — see the file-level doc comment. Errors
    // are reported through `onDriveError`, never left as an unhandled
    // rejection that could take the whole daemon down.
    void drive(runId, resolved.changeSet, resolved.workUnits, resolved.envelope, policy)
      .then(async (result) => {
        // The run's lifecycle state must reflect how its drive ended, or a
        // failed/blocked run stays `running` and blocks every retry (F5).
        const to = terminalStateFor(result.stopped);
        if (to !== undefined) await settleRunState(runId, changeSetId, to);
      })
      .catch(async (err: unknown) => {
        onDriveError(runId, err);
        // A drive that threw did not complete — fail the run so the change
        // set is retryable rather than wedged `running`.
        await settleRunState(runId, changeSetId, "failed");
      })
      .finally(release);
  }

  return {
    /**
     * Creates a run for an approved change set and starts driving it.
     *
     * Refusing NEVER creates a run to block. `blocked` is absorbing, so a
     * halted run would strand the change set with no recovery path short of a
     * hand-edited policy and a brand-new `requestKey`; and at dispatch time a
     * run has no prior record, so `draft → blocked` is not even a legal edge
     * — the halt would have thrown inside an un-awaited driver after this
     * method already answered `accepted: true`. Refusing leaves the change
     * set `ready`, so fixing the cause and dispatching again just works.
     */
    async dispatch(changeSetId: string): Promise<RunDispatchOutcome> {
      // CLAIM THE CHANGE SET SYNCHRONOUSLY, before any `await`. Roast round 2
      // (F1) proved the read-then-await-then-write form: both guards were
      // read before the first await and `inFlight.add` happened after it, so
      // two concurrent `run.dispatch` calls on one change set each saw an
      // empty in-flight set and an empty registry, and BOTH created a run —
      // two live runs over the same work units and worktrees, with no human
      // review anywhere. The UDS server serializes per connection only, so
      // two connections is all it took. Reproduced: `runs.list()` returned
      // two records in `running` for one changeSetId.
      //
      // A `Set` add is atomic with respect to the event loop, so claiming
      // first and releasing in `finally` is what actually delivers the
      // "idempotent per change set" contract this method documents.
      if (inFlight.has(changeSetId)) {
        return { accepted: false, reason: "change set is already being dispatched" };
      }
      inFlight.add(changeSetId);

      let released = false;
      const release = (): void => {
        if (!released) {
          released = true;
          inFlight.delete(changeSetId);
        }
      };

      try {
        const live = findLiveRunForChangeSet(deps.runs, changeSetId);
        if (live !== undefined) {
          release();
          return {
            accepted: false,
            reason: `change set "${changeSetId}" already has run "${live.runId}" in flight (${live.runState})`,
          };
        }

        // Roast round 2, F2: `ready` is never cleared, so without this a
        // change set whose run already published would mint a second run and
        // re-publish finished work unreviewed. Retrying after a failure,
        // block or cancel stays allowed — only re-publishing a success is
        // refused.
        const published = findPublishedRunForChangeSet(deps.runs, changeSetId);
        if (published !== undefined) {
          release();
          return {
            accepted: false,
            reason: `change set "${changeSetId}" already published under run "${published.runId}"; amend it rather than dispatching it again`,
          };
        }

        const resolved = resolveChangeSet(changeSetId);
        if (!resolved.ok) {
          release();
          return { accepted: false, reason: resolved.reason };
        }

        // THE STANDING-APPROVAL GATE (ledger Gap 18). Everything from here
        // to `beginDriving` is what replaces the per-ChangeSet human prompt.
        const gate = resolvePolicyGate(resolved.envelope);
        if (!gate.ok) {
          release();
          return { accepted: false, reason: gate.reason };
        }

        // Part 4: the authorizing digest is journaled WITH the dispatch, so
        // "what was the human standing behind when this ran" stays answerable
        // after the fact. A standing approval makes that unanswerable
        // otherwise -- there is no per-run artifact to point at.
        await deps.journal.appendEntry({
          type: "adjudication_decision",
          changeSetId,
          payload: {
            decision: "policy_contained",
            rationale: `dispatch authorized by standing EnvelopePolicy ${gate.digest}`,
          },
        });

        let runId: string;
        try {
          runId = (
            await createRun({
              journal: deps.journal,
              runs: deps.runs,
              changeSets: deps.changeSets,
              changeSetId,
              runId: randomUUID(),
            })
          ).runId;
        } catch (err) {
          // `createRun` refuses a change set that is not `ready` — i.e. one no
          // approval gate has passed. That is the standing-approval boundary
          // itself, so it is reported as a refusal rather than raised.
          release();
          return { accepted: false, reason: err instanceof Error ? err.message : String(err) };
        }

        // Hands the claim over to the drive, which releases it when it settles.
        beginDriving(runId, resolved, gate.policy, release);
        return { accepted: true, runId };
      } catch (err) {
        release();
        throw err;
      }
    },

    /** Re-drives a run that already exists — crash recovery and limit-park re-dispatch. */
    resume(runId: string): Promise<RunDispatchOutcome> {
      const run = deps.runs.get(runId);
      if (run === undefined) {
        return Promise.resolve({ accepted: false, reason: `unknown run "${runId}"` });
      }
      if (isRunLifecycleAbsorbing(run.runState)) {
        return Promise.resolve({
          accepted: false,
          reason: `run "${runId}" is ${run.runState} and cannot be resumed`,
        });
      }
      // Claimed synchronously, for the same reason `dispatch` does it (F1):
      // this method has no `await` before the claim today, and must not grow
      // one without keeping the claim first.
      if (inFlight.has(run.changeSetId)) {
        return Promise.resolve({ accepted: false, reason: "run is already being dispatched" });
      }

      const resolved = resolveChangeSet(run.changeSetId);
      if (!resolved.ok) return Promise.resolve({ accepted: false, reason: resolved.reason });

      // Resume runs the SAME gate. A run that was authorized once must not
      // keep executing under an authorization the owner has since narrowed --
      // otherwise editing the policy would silently fail to bind anything
      // already in flight, and "re-drive after a crash" would become a way
      // around it.
      const gate = resolvePolicyGate(resolved.envelope);
      if (!gate.ok) return Promise.resolve({ accepted: false, reason: gate.reason });

      inFlight.add(run.changeSetId);
      let released = false;
      beginDriving(runId, resolved, gate.policy, () => {
        if (!released) {
          released = true;
          inFlight.delete(run.changeSetId);
        }
      });
      return Promise.resolve({ accepted: true });
    },
  };
}

/**
 * `resolveWorkerAuthMaterial` deliberately no longer lives here — it moved
 * to `./worker-auth.js`. The daemon calls it at STARTUP, and this module
 * statically imports `@crabgic/engine-claude` (and through it
 * `@anthropic-ai/claude-agent-sdk`, +40.9 MiB), so resolving a token from
 * here loaded the whole engine into a daemon that may never dispatch a run.
 * See `./lazy-run-dispatcher.ts` for the rest of that story.
 */

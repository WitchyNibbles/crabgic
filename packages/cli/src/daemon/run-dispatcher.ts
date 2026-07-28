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
import { isRunLifecycleAbsorbing } from "@crabgic/contracts";
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
  type RunDispatcher,
  type RunDispatchOutcome,
  type SupervisorDependencies,
  type TerminableWorker,
} from "@crabgic/supervisor";
import {
  createGitPlumbing,
  createNodeGitSpawn,
  createWorktree,
  ensureControlClone,
  freezeIntake,
  resolveGitControlDir,
  resolveWorktreesRootDir,
  type GitPlumbing,
} from "@crabgic/git-engine";
import { compileEnvelope, isContained } from "@crabgic/engine-core";
import type { AdjudicationCallback, EngineAdapter } from "@crabgic/engine-core";
import { ClaudeEngineAdapter, type WorkerAuthMaterial } from "@crabgic/engine-claude";
import { buildTaskPacket, driveRun, type WorkerDispatchContext } from "@crabgic/scheduler";
import type { LoadPolicyResult } from "../policy/policy-store.js";

/** Git identity for worktree commits. `@crabgic/git-engine` deliberately leaves resolving this to its caller (see `configureGitIdentity`'s own doc comment). */
const DEFAULT_SERVICE_EMAIL = "crabgic@localhost";

/** The ref a run is based on when the caller names none. */
const DEFAULT_TARGET_REF = "HEAD";

/** Per-attempt engine turn cap — not a retry count; 13's `dispatchAttempt` owns repair policy. */
const DEFAULT_MAX_TURNS = 40;

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
      return { ok: false, reason: loaded.reason };
    }

    const containment = isContained(envelope, loaded.policy);
    if (!containment.contained) {
      // Every escaping dimension, not the first: the owner has to edit a file
      // this process cannot reach, so one refusal must tell them the whole
      // gap rather than making recovery an iterative guessing game.
      return {
        ok: false,
        reason: `this change set needs authority the standing policy does not grant: ${containment.reasons.join("; ")}`,
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
  ): Promise<void> {
    const controlDir = resolveGitControlDir(xdgEnv, projectHash);
    const worktreesRootDir = resolveWorktreesRootDir(xdgEnv, projectHash);

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

    await driveRun(
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
              resourceLimits: { maxTurns: DEFAULT_MAX_TURNS },
              resultSchema: WORKER_RESULT_SCHEMA,
              envelope,
            }).packet,
          ),
        createAdapter: async (ctx) => {
          const worktreePath =
            options.createAttemptWorktree !== undefined
              ? await options.createAttemptWorktree(ctx, baseObjectId)
              : (
                  await createWorktree(plumbing, {
                    repoDir: controlDir,
                    worktreesRootDir,
                    runId,
                    changeSetId: changeSet.id,
                    taskId: ctx.workUnit.id,
                    baseObjectId,
                    serviceEmail,
                  })
                ).worktreePath;
          if (options.createAdapter !== undefined) {
            return options.createAdapter(ctx, worktreePath, deps.journal);
          }
          const provisioning = await provisionWorkerDirs(
            join(worktreesRootDir, "workers"),
            ctx.workUnit.id,
          );
          return new ClaudeEngineAdapter({
            worktreePath,
            provisioning,
            auth: options.auth,
            journal: deps.journal,
            model: ctx.model,
            runId,
          });
        },
      },
    );
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
    // Deliberately NOT awaited — see the file-level doc comment. Errors
    // are reported through `onDriveError`, never left as an unhandled
    // rejection that could take the whole daemon down.
    void drive(runId, resolved.changeSet, resolved.workUnits, resolved.envelope, policy)
      .catch((err: unknown) => {
        onDriveError(runId, err);
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

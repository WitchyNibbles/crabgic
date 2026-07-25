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
 * It lives in `packages/cli` rather than `@eo/supervisor` for the same
 * reason the daemon entry point does: it needs `@eo/engine-claude`, which
 * already depends on `@eo/supervisor`, so composing it there would be a
 * dependency cycle. `@eo/supervisor` declares only the interface
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
import type { AuthorizationEnvelope, ChangeSet, WorkUnit } from "@eo/contracts";
import type { XdgEnv } from "@eo/journal";
import type { JournalStore } from "@eo/journal";
import {
  provisionWorkerDirs,
  type RunDispatcher,
  type RunDispatchOutcome,
  type SupervisorDependencies,
  type TerminableWorker,
} from "@eo/supervisor";
import {
  createGitPlumbing,
  createNodeGitSpawn,
  createWorktree,
  ensureControlClone,
  freezeIntake,
  resolveGitControlDir,
  resolveWorktreesRootDir,
  type GitPlumbing,
} from "@eo/git-engine";
import { compileEnvelope } from "@eo/engine-core";
import type { AdjudicationCallback, EngineAdapter } from "@eo/engine-core";
import { ClaudeEngineAdapter, type WorkerAuthMaterial } from "@eo/engine-claude";
import { buildTaskPacket, driveRun, type WorkerDispatchContext } from "@eo/scheduler";

/** Git identity for worktree commits. `@eo/git-engine` deliberately leaves resolving this to its caller (see `configureGitIdentity`'s own doc comment). */
const DEFAULT_SERVICE_EMAIL = "engineering-orchestrator@localhost";

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
  /** The repository checkout to freeze and cut worktrees from (`EO_PROJECT_DIR`). */
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
}

type ResolvedRun =
  | {
      readonly ok: true;
      readonly changeSet: ChangeSet;
      readonly workUnits: readonly WorkUnit[];
      readonly envelope: AuthorizationEnvelope;
    }
  | { readonly ok: false; readonly reason: string };

export function createRealRunDispatcher(options: RealRunDispatcherOptions): RunDispatcher {
  const { deps, projectDir, xdgEnv, projectHash } = options;
  const serviceEmail = options.serviceEmail ?? DEFAULT_SERVICE_EMAIL;
  const targetRef = options.targetRef ?? DEFAULT_TARGET_REF;
  const adjudicate = options.adjudicate ?? REFUSE_ALL_ADJUDICATIONS;
  const plumbing = options.plumbing ?? createGitPlumbing({ spawnFn: createNodeGitSpawn() });
  const onDriveError = options.onDriveError ?? ((): void => undefined);

  /** Runs this daemon is already driving — makes `dispatch` idempotent per run. */
  const inFlight = new Set<string>();

  /** Resolves everything a run needs, or explains precisely what is missing. */
  function resolveRun(runId: string): ResolvedRun {
    const run = deps.runs.get(runId);
    if (run === undefined) return { ok: false, reason: `unknown run "${runId}"` };

    const changeSet = deps.changeSets.get(run.changeSetId);
    if (changeSet === undefined) {
      return {
        ok: false,
        reason: `run "${runId}" references unknown change set "${run.changeSetId}"`,
      };
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
    const profile = compileEnvelope(envelope);

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

  return {
    dispatch(runId: string): Promise<RunDispatchOutcome> {
      if (inFlight.has(runId)) {
        return Promise.resolve({ accepted: false, reason: "run is already being dispatched" });
      }
      const resolved = resolveRun(runId);
      if (!resolved.ok) return Promise.resolve({ accepted: false, reason: resolved.reason });

      inFlight.add(runId);
      // Deliberately NOT awaited — see the file-level doc comment. Errors
      // are reported through `onDriveError`, never left as an unhandled
      // rejection that could take the whole daemon down.
      void drive(runId, resolved.changeSet, resolved.workUnits, resolved.envelope)
        .catch((err: unknown) => {
          onDriveError(runId, err);
        })
        .finally(() => {
          inFlight.delete(runId);
        });

      return Promise.resolve({ accepted: true });
    },
  };
}

/**
 * `resolveWorkerAuthMaterial` deliberately no longer lives here — it moved
 * to `./worker-auth.js`. The daemon calls it at STARTUP, and this module
 * statically imports `@eo/engine-claude` (and through it
 * `@anthropic-ai/claude-agent-sdk`, +40.9 MiB), so resolving a token from
 * here loaded the whole engine into a daemon that may never dispatch a run.
 * See `./lazy-run-dispatcher.ts` for the rest of that story.
 */

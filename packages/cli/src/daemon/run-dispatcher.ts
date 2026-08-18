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
 *
 * ...WHICH IS WHY `drain()` EXISTS. Detachment means the process can be told
 * to exit while a drive is still appending to the journal, and the project
 * lease is the journal's only single-writer guarantee (`appendEntry` takes no
 * lock). `drain` closes the door, waits for every detached drive it is
 * tracking, terminates whatever is still live at the deadline, and reports
 * precisely what it could not settle — so the boot layer can release the
 * lease LAST, or not at all. See `@crabgic/supervisor`'s `RunDispatcher.drain`
 * and `bootSupervisor`'s teardown order.
 */
import { join } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  isRunLifecycleAbsorbing,
  IllegalTransitionError,
  CURRENT_SCHEMA_VERSION,
  WorkerAuthoredResultSchema,
} from "@crabgic/contracts";
import type { RunLifecycleState } from "@crabgic/contracts";
import type {
  AuthorizationEnvelope,
  ChangeSet,
  EnvelopePolicy,
  WorkUnit,
} from "@crabgic/contracts";
import type { XdgEnv } from "@crabgic/journal";
import {
  CRABGIC_DIR_NAME,
  findLatestCriteriaSeal,
  getLatestAttemptForRun,
  resolveXdgCacheHome,
  resolveXdgStateHome,
  type JournalStore,
} from "@crabgic/journal";
import {
  createRun,
  findLiveRunForChangeSet,
  findPublishedRunForChangeSet,
  provisionWorkerDirs,
  resolveRequirementsStrict,
  transitionRun,
  DISPATCHER_DRAINING_REASON,
  type DrainOptions,
  type DrainOutcome,
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
  getParkStatus,
  resumeAttempt,
  type DispatchAttemptOutcome,
  type DriveRunResult,
  type WorkerDispatchContext,
} from "@crabgic/scheduler";
import { captureTddBaseline } from "@crabgic/gates";
import type { LoadPolicyResult } from "../policy/policy-store.js";
import { composeGateRegistry } from "./compose-gate-registry.js";
import {
  createRealPostCompletionGitEffects,
  type PostCompletionGitEffects,
} from "./post-completion-git-effects.js";
import { runPostCompletionPipeline, type PostCompletionStep } from "./post-completion-pipeline.js";

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
 * The result shape every worker must return — DERIVED from the schema the
 * validator enforces, never restated.
 *
 * It used to be a hand-written literal: `{outcome, summary}`, with only
 * `outcome` required. The validator meanwhile enforced the full seven-field
 * `WorkerResultSchema`. Two schemas that had to agree and nothing compared
 * them, so every worker obeyed the contract it was handed and every result was
 * rejected as malformed. Measured on run 97fb3b10 (2026-08-16): a worker wrote
 * correct code, reported `{outcome, summary}` exactly as instructed, and the
 * attempt failed as a `schemaViolation`. No worker could ever have succeeded.
 *
 * `z.toJSONSchema` is zod 4's own emitter, so the published document is a
 * projection of the enforced schema rather than a second description of it.
 * Exported so `./worker-result-schema.test.ts` can hold it against
 * `WorkerAuthoredResultSchema`; that test is the thing that makes the two
 * unable to drift apart again.
 */
export const WORKER_RESULT_SCHEMA: Record<string, unknown> = ((): Record<string, unknown> => {
  /**
   * `$schema` is STRIPPED, and the engine is why. `z.toJSONSchema` stamps
   * `"$schema": "https://json-schema.org/draft/2020-12/schema"`, and the
   * engine's `--json-schema` validator refuses a document whose meta-schema it
   * cannot resolve:
   *
   *     Error: --json-schema is not a valid JSON Schema: no schema with key or
   *     ref "https://json-schema.org/draft/2020-12/schema"
   *
   * Measured on run 1387f6d1 (2026-08-16), which died 1.3s in, before the
   * worker existed. Dropping the annotation changes nothing about what the
   * document DESCRIBES — every constraint below it is untouched — so this is a
   * transport concession, not a weakening of the contract.
   */
  const { $schema: _unusedMetaSchema, ...schema } = z.toJSONSchema(WorkerAuthoredResultSchema) as {
    $schema?: unknown;
  } & Record<string, unknown>;
  return schema;
})();

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
  /**
   * Epoch-SECONDS clock, threaded to the driver's park-resume readiness
   * check. Injected so a test can make a rate-limit window pass BETWEEN a
   * dispatch (which parks) and a later `resume` (which continues the parked
   * unit) deterministically. Defaults to the real wall clock.
   */
  readonly nowSeconds?: () => number;
  /**
   * Seam: the GIT half of the post-completion pipeline (collect / integrate /
   * publish). Defaults to `createRealPostCompletionGitEffects` over the control
   * clone and the user checkout. Injected by tests that script a succeeding
   * worker over fake git seams, so they need no real repository.
   *
   * THE SEAM STOPS HERE, AND THAT IS THE POINT. There is deliberately NO option
   * to substitute the gate registry, the `final_verifying` firing, or the
   * verdict → run-lifecycle mapping: `composeGateRegistry` is called
   * unconditionally below and the pipeline owns the mapping. A seam above the
   * firing would let a test supply its own registry and pass while production
   * registered nothing — the exact harness-only reach defect
   * `14-gate-registry-never-composed.md` documents.
   */
  readonly postCompletionGitEffects?: PostCompletionGitEffects;
  /** Test-only OBSERVER of the pipeline's internal checkpoints (`onStep`, the same pattern 07's git primitives use). Cannot substitute, skip or alter anything. */
  readonly onPostCompletionStep?: (step: PostCompletionStep) => void | Promise<void>;
}

type ResolvedRun =
  | {
      readonly ok: true;
      readonly changeSet: ChangeSet;
      readonly workUnits: readonly WorkUnit[];
      readonly envelope: AuthorizationEnvelope;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * One settled drive, plus the two values the post-completion pipeline needs and
 * `drive` is the only place that knows: the run's ONE frozen base object id, and
 * the control clone the candidates and the integration ref live in.
 */
interface DrivenRun {
  readonly result: DriveRunResult;
  readonly baseObjectId: string;
  readonly controlDir: string;
}

type PolicyGate =
  | { readonly ok: true; readonly policy: EnvelopePolicy; readonly digest: string }
  | { readonly ok: false; readonly reason: string };

/**
 * What one run-scoped journal sweep concluded about a `resume` — see
 * `classifyResume`. Both refusals share the sweep and the precedence, so
 * neither can drift from the other or from what the drive would actually do.
 */
type ResumeVerdict =
  | { readonly kind: "resumable" }
  /** Every reachable unit is parked on a session this process no longer holds. */
  | { readonly kind: "strandedParks"; readonly unitIds: readonly string[] }
  /** Every reachable unit is parked with its rate-limit window still open. */
  | {
      readonly kind: "parkedNotDue";
      readonly units: readonly { readonly unitId: string; readonly resetsAt: number | undefined }[];
    }
  /** Every unit is terminal and at least one did not succeed — a re-drive has nothing to dispatch. */
  | {
      readonly kind: "terminalDeadEnd";
      readonly failedIds: readonly string[];
      readonly cancelledIds: readonly string[];
    };

/**
 * The refusal a `terminalDeadEnd` verdict earns, in the register PR #46
 * established for the stranded-park one: name what is in the way, say why
 * waiting cannot help, and name the exit that works. An operator reading a
 * bare "cannot be resumed" has no way to discover that `cancel` — on a run
 * that already stopped doing anything — is the move.
 */
function terminalDeadEndReason(
  runId: string,
  failedIds: readonly string[],
  cancelledIds: readonly string[],
): string {
  const counts = [
    failedIds.length > 0 ? `${failedIds.length} failed` : undefined,
    cancelledIds.length > 0 ? `${cancelledIds.length} cancelled` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
  return (
    `run "${runId}" cannot be resumed: every work unit has already reached a terminal ` +
    `outcome (${counts}), so a re-drive has nothing left to dispatch and resuming cannot ` +
    `advance it. Waiting will not change that — cancel the run ` +
    `(\`crabgic cancel ${runId}\`) and dispatch the change set again.`
  );
}

/**
 * The refusal a `parkedNotDue` verdict earns — the one member of PR #46's
 * register where WAITING IS THE EXIT, so it names the reset time instead of
 * sending the operator to `cancel`.
 *
 * It exists because the opposite was measured: `resume` answered `accepted`,
 * cut a fresh intake freeze and transitioned nothing, so a "parked → resume"
 * poll wrote 214 `git_freeze` entries and made no progress while every reply
 * said yes. A refusal an operator can act on turns that loop into one message.
 *
 * The earliest reset is quoted because that is when a re-drive first has
 * something to do; a unit with no recorded timer is reported as unknown rather
 * than defaulted to a time nobody journaled.
 */
function parkedNotDueReason(
  runId: string,
  units: readonly { readonly unitId: string; readonly resetsAt: number | undefined }[],
): string {
  const times = units
    .map((unit) => unit.resetsAt)
    .filter((resetsAt): resetsAt is number => resetsAt !== undefined);
  const when =
    times.length === units.length && times.length > 0
      ? `not before ${new Date(Math.min(...times) * 1000).toISOString()}`
      : "at a time this run has not recorded for every unit";
  return (
    `run "${runId}" cannot be resumed yet: ${String(units.length)} work unit(s) are parked on a ` +
    `rate limit whose window has not passed. Re-driving now would freeze the repository again ` +
    `and re-park them unchanged. Unlike the other refusals, WAITING IS THE FIX — retry ${when}. ` +
    `The daemon's own park-resume driver retries on that schedule, so no action is needed.`
  );
}

/**
 * The three non-absorbing run-lifecycle states `./post-completion-pipeline.ts`
 * owns. A run resting in one of them is mid-pipeline: its drive completed, the
 * pipeline started, and this daemon then stopped (a crash, or a hard shutdown).
 */
const PIPELINE_STAGES: readonly RunLifecycleState[] = [
  "verifying",
  "integrating",
  "final_verifying",
];

/**
 * The refusal a mid-pipeline `resume` earns, in the register PR #46 established:
 * name what is in the way, say why re-driving cannot help, and name the exit
 * that works.
 *
 * A RE-DRIVE CANNOT ADVANCE THIS RUN, and the reason is structural rather than a
 * missing feature: the pipeline collects each unit's work from the attempt
 * worktree path held in this dispatcher's in-process retained map, which does
 * not survive a restart; and `verifying → verifying` is not an edge, so a
 * re-drive that reached the pipeline would fail on its first transition anyway.
 * Answering `accepted: true` here would be the same lie PR #46 removed from the
 * stranded-park path. Restart-safe pipeline resume (durable worktree-ref
 * recovery) is the deliberate follow-on.
 */
function midPipelineReason(runId: string, state: RunLifecycleState): string {
  return (
    `run "${runId}" cannot be resumed: it is ${state}, mid-way through post-completion ` +
    `verification/integration, and the attempt worktrees that work would be collected from are ` +
    `held only in the daemon process that started the pipeline. Re-driving cannot advance it — ` +
    `cancel the run (\`crabgic cancel ${runId}\`) and dispatch the change set again.`
  );
}

/** Shutdown defaults for a direct caller; the daemon's boot layer passes its own (`bootSupervisor`). */
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_DRAIN_GRACE_MS = 5_000;

/** One detached drive, kept alongside the run so `drain` can wait for it, terminate its workers, and record its end. */
interface LiveDrive {
  readonly changeSetId: string;
  readonly workUnitIds: readonly string[];
  /** Resolves (never rejects) once the drive AND its settle bookkeeping are finished. */
  readonly settled: Promise<void>;
}

const NOTHING_DRAINED: DrainOutcome = {
  settledRunIds: [],
  cancelledRunIds: [],
  unsettledRunIds: [],
};

/**
 * The real dispatcher, plus the quiescence primitive `drain` is built from.
 *
 * `whenIdle` is NOT on the `RunDispatcher` interface: the production caller
 * of quiescence is shutdown, and shutdown wants the door-closing `drain`. It
 * is exposed here because a caller that must wait for a drive and then keep
 * using the dispatcher (a park-resume across drives) cannot use a one-way
 * door, and re-deriving the settle point from refusal messages — which is
 * what the suite did before this — is exactly the kind of hand-rolled
 * predicate that made the closed-loop e2e delete its own temp directory out
 * from under a live drive.
 */
export interface RealRunDispatcher extends RunDispatcher {
  /** Resolves when no drive is in flight. Unlike `drain`, it keeps accepting work. */
  whenIdle(): Promise<void>;
}

export function createRealRunDispatcher(options: RealRunDispatcherOptions): RealRunDispatcher {
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
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  /**
   * THE gate registry — one instance per dispatcher, built unconditionally, with
   * no option to substitute it. This is the production composition root phase
   * 14's registry never had (defect `14-gate-registry-never-composed.md`:
   * `createGateRegistry` had zero production call sites). Deleting this line
   * makes `fireFinalCandidateVerification`'s `requireAtLeastOne` throw and every
   * completed run fail closed, which is what the deletion probe measures.
   */
  const gateRegistry = composeGateRegistry(deps);

  /**
   * The detached drives themselves, keyed by runId — the promise half of what
   * `inFlight` only ever tracked as a claim. `inFlight` answers "is this
   * change set spoken for"; this answers "is anything still WRITING", which is
   * the question shutdown has to ask before the single-writer lease can be
   * handed back. Entries are removed by the same settle path that releases the
   * claim, so an idle dispatcher holds an empty map.
   */
  const liveDrives = new Map<string, LiveDrive>();
  /** Set by `drain`, never cleared — see `RunDispatcher.drain`'s one-way-door contract. */
  let draining = false;

  // NOTE: this dispatcher briefly constructed an in-memory attempt cache
  // (`AttemptCacheSeam`) so a same-daemon re-drive would reuse succeeded
  // attempts. `driveRun` now seeds each unit's status from the DURABLE
  // journal instead — a succeeded unit is never re-selected — which does the
  // same job restart-safely and without a second mechanism keyed on the
  // authorizing policy digest. The cache was removed rather than kept as
  // unreachable dead code (its review's F2). See `@crabgic/scheduler`'s
  // `driveRun` journal-seed.

  /**
   * Per-RUN retained adapters, surviving ACROSS this daemon's re-drives of the
   * same run — keyed by runId, then by workUnitId. A unit parked on a rate
   * limit is resumed on a LATER drive (a `crabgic resume <runId>` once the
   * window passes), and that resume needs the SAME adapter instance that
   * spawned the session, so it continues with full authority instead of the
   * read-only fallback. A per-`drive()` map would be empty on that later
   * drive; keying at the dispatcher level makes the documented limit-park
   * re-dispatch actually reuse the session.
   *
   * Dropped when the run reaches a NON-parked outcome (`clearRetainedRun` from
   * the settle path) — a parked run keeps its adapters for the next resume.
   * SAME-DAEMON only: a daemon restart loses this map, and a re-drive then
   * declines to resume (leaves the unit parked) rather than continue into a
   * read-only session. Durable, restart-safe session context is the ledger's
   * separate carry-forward.
   */
  const retainedByRun = new Map<
    string,
    Map<
      string,
      { readonly adapter: EngineAdapter; readonly worktreePath: string; readonly configDir: string }
    >
  >();
  const clearRetainedRun = (runId: string): void => {
    retainedByRun.delete(runId);
  };

  /**
   * Evicts retained adapters for runs that can no longer resume. The settle
   * path (`beginDriving`) drops a run's adapters when its OWN drive ends
   * non-parked, but a `run.cancel` transitions a PARKED run to `cancelled`
   * through the supervisor router — never touching this dispatcher — so its
   * adapters would otherwise stay pinned until a daemon restart. Sweeping on
   * every `dispatch`/`resume` bounds that: a cancelled (or otherwise
   * absorbing, or vanished) run's session context is freed at the next
   * dispatcher activity. A parked run that is simply never resumed keeps its
   * adapters by design — that is the retention this feature exists for.
   */
  const sweepStaleRetention = (): void => {
    for (const runId of [...retainedByRun.keys()]) {
      const run = deps.runs.get(runId);
      if (run === undefined || isRunLifecycleAbsorbing(run.runState)) {
        retainedByRun.delete(runId);
      }
    }
  };

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
    const envelope = deps.envelopes.get(changeSet.authorizationEnvelopeId);
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
  ): Promise<DrivenRun> {
    const controlDir = resolveGitControlDir(xdgEnv, projectHash);
    const worktreesRootDir = resolveWorktreesRootDir(xdgEnv, projectHash);

    // This run's retained adapters, surviving across the daemon's re-drives of
    // the run (see `retainedByRun`). A resume needs the SAME adapter instance
    // that spawned the session — only it holds that session's `{packet,
    // profile}` context, so `adapter.resume` continues with full authority
    // instead of the read-only fallback a fresh adapter gets.
    const retainedWorkers = ((): Map<
      string,
      { readonly adapter: EngineAdapter; readonly worktreePath: string; readonly configDir: string }
    > => {
      const existing = retainedByRun.get(runId);
      if (existing !== undefined) return existing;
      const created = new Map<
        string,
        {
          readonly adapter: EngineAdapter;
          readonly worktreePath: string;
          readonly configDir: string;
        }
      >();
      retainedByRun.set(runId, created);
      return created;
    })();

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
    // The compiler's own deny literals are XDG DEFAULTS (`~/.local/state/...`)
    // and do not track a custom `$XDG_STATE_HOME`. That matters because the
    // engine's `Write`/`Edit` tools run outside the bubblewrap boundary, so
    // for them the deny RULE is the only thing between a worker and the
    // journal. Resolving the real roots here — the composition root is the
    // only place that knows them — closes that gap without giving
    // `@crabgic/engine-core` a dependency on `@crabgic/journal`.
    const profile = compileEnvelope(envelope, policy, {
      stateRoot: `${resolveXdgStateHome(xdgEnv)}/${CRABGIC_DIR_NAME}`,
      cacheRoot: `${resolveXdgCacheHome(xdgEnv)}/${CRABGIC_DIR_NAME}`,
    });

    const result = await driveRun(
      { runId, changeSetId: changeSet.id, workUnits },
      {
        journal: deps.journal,
        liveWorkers: deps.liveWorkers,
        adjudicate,
        nowSeconds,
        compileProfile: () => Promise.resolve(profile),
        // roadmap/24: the bar this unit is judged against. Both halves come
        // from durable state the worker cannot rewrite without detection —
        // the records from the registry intake persisted, the seal from the
        // append-only journal at approval time. Resolved per attempt rather
        // than cached for the run, so a re-approval after a material
        // amendment is picked up rather than judged against a stale bar.
        //
        // STRICT resolution, deliberately (2026-08-04). A declared requirement
        // id that resolves to no record is a REFUSAL, not an empty bar: the
        // registry is file-backed and ENOENT-tolerant, and the executor accepts
        // an empty presented set by design (a chore unit owns none), so
        // dropping unresolvable ids here would let a deleted or never-written
        // `requirements.json` silently downgrade a sealed acceptance bar to no
        // bar at all. That was the second half of defect
        // `24-daemon-requirements-registry-unwired.md`, and wiring the registry
        // without this would have left it standing.
        //
        // A throw settles the whole RUN `failed` through `beginDriving`'s
        // `.catch` below — deliberately RUN-level, and NOT the per-unit
        // `failed`-with-typed-reason that a tamper earns. The two conditions
        // are different in kind (orchestrator ruling, 2026-08-04):
        //
        //   - TAMPER means the approved criteria changed after approval. That
        //     is a verdict on ONE unit's OUTPUT against its bar, so it belongs
        //     to that unit — which is exactly what phase 24 specifies.
        //   - AN UNRESOLVABLE DECLARED ID means the run's acceptance basis is
        //     INCOHERENT: the registry does not contain what intake declared.
        //     That is an integrity failure of the run's INPUTS, not a verdict
        //     on anybody's output. If the requirement source cannot be
        //     resolved, EVERY unit's verification in this run is untrustworthy,
        //     not just the one that happened to trip it — so settling the
        //     remaining units and reporting success would be wrong.
        //
        // Hence no synthetic seal failure and no growth of
        // `CriteriaSealFailureReason`, which is a 3-member vocabulary owned by
        // `@crabgic/contracts` (ledger-adjacent). Phase 24 specified per-unit
        // semantics for tamper and was SILENT here; the silence is filled by
        // the ruling above rather than by a decision taken at a call site.
        resolveCriteriaSeal: async (ctx) => ({
          requirements: resolveRequirementsStrict(
            deps.requirements,
            ctx.workUnit.requirementIds,
            ctx.workUnit.id,
          ),
          approvalSeal: await findLatestCriteriaSeal(deps.journal, changeSet.id),
        }),
        buildPacket: (ctx) => {
          /**
           * THE LAST HOP (roadmap/25 WI 3). The requirements are resolved from
           * the same strict registry `resolveCriteriaSeal` uses, and their
           * acceptance criteria are copied onto the packet VERBATIM.
           *
           * Before this the worker received `requirementIds` and nothing else —
           * a reference it could not resolve, because the registry lives with
           * the supervisor and not in the worktree. The party obliged to satisfy
           * the criteria was the only party that could not read them.
           *
           * `resolveRequirementsStrict` throws for an unresolvable declared id
           * rather than dropping it: phase 24's ruling is that an unresolvable
           * id means the run's acceptance basis is incoherent, which is an
           * integrity failure of the run's inputs rather than a verdict on any
           * one unit's output.
           */
          const requirements = resolveRequirementsStrict(
            deps.requirements,
            ctx.workUnit.requirementIds,
            ctx.workUnit.id,
          );
          return Promise.resolve(
            buildTaskPacket({
              id: randomUUID(),
              workUnitId: ctx.workUnit.id,
              requirementIds: [...ctx.workUnit.requirementIds],
              spec: {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                id: randomUUID(),
                taskId: ctx.workUnit.id,
                requirements: requirements.map((requirement) => ({
                  requirementId: requirement.id,
                  acceptanceCriteria: [...requirement.acceptanceCriteria],
                })),
                /**
                 * `WorkUnit` carries no done-criteria of its own, so the
                 * acceptance criteria ARE the bar here. Inventing a separate
                 * list would be the packet asserting a bar nobody set.
                 */
                doneCriteria: requirements.flatMap((requirement) => [
                  ...requirement.acceptanceCriteria,
                ]),
                testsFirst: true,
                permittedInterfaces: [...ctx.workUnit.ownedPaths],
              },
              objective: ctx.workUnit.title,
              baseObjectId,
              ownedPaths: [...ctx.workUnit.ownedPaths],
              resourceLimits: { maxTurns: envelope.maxTurnsPerAttempt },
              resultSchema: WORKER_RESULT_SCHEMA,
              envelope,
            }).packet,
          );
        },
        /**
         * The PRE-DISPATCH TDD BASELINE — owner decision 2026-08-18, "harness
         * runs it pre-dispatch", and the production caller
         * `captureRedBaseline` never had.
         *
         * ⚠️ MEASURED BEFORE THIS EXISTED: `captureRedBaseline` had zero
         * production call sites and `@crabgic/scheduler` journaled no
         * `evidence_pointer` entry of any kind, so no run could ever produce
         * the red half of the red-before-green pair. `implement-tests-first`
         * was therefore underivable for every change set
         * (`../review/gate-criteria.ts` refuses to presume a missing verdict
         * green), which is where owner ruling R7's staged run stopped.
         *
         * THE WORKTREE COMES FROM `retainedWorkers`, NOT A SECOND `git
         * worktree add`. `createAdapter` above is the one place that creates
         * and provisions an attempt's worktree, and the driver resolves it
         * before calling this seam, so the entry is present. A missing entry
         * is a REFUSAL rather than a fresh worktree: cutting a second one here
         * would run the baseline against a tree the worker never sees.
         *
         * THE COMMAND COMES FROM THE APPROVED ENVELOPE, and
         * `captureTddBaseline` filters it to the `acceptance` class itself. An
         * envelope granting no test command authorizes no test run, so nothing
         * is executed and no baseline is journaled — the gate then fails closed,
         * which is the correct direction and the one the operating protocol's
         * "expanded authority" refusal demands.
         */
        captureBaseline: async (ctx, packet): Promise<void> => {
          const retained = retainedWorkers.get(ctx.workUnit.id);
          if (retained === undefined) {
            throw new Error(
              `run dispatcher: no worktree retained for work unit "${ctx.workUnit.id}" — ` +
                `refusing to capture a TDD baseline against a tree the worker will not see`,
            );
          }
          await captureTddBaseline({
            journal: deps.journal,
            changeSetId: changeSet.id,
            workUnitId: ctx.workUnit.id,
            requirementIds: [...ctx.workUnit.requirementIds],
            baseObjectId: packet.baseObjectId,
            worktreePath: retained.worktreePath,
            grantedCommands: envelope.commands,
          });
        },
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
            // The SAME bar the fresh dispatch is held to — a park-resume must
            // not become a way to complete against an unverified one.
            criteriaSeal: {
              // Strict on BOTH seams — see the dispatch site above for the
              // inputs-incoherent vs verdict-on-output reasoning, and for why
              // this refusal is run-level rather than per-unit. A park-resume
              // that resolved leniently would be a second entry point into the
              // acceptance funnel that skipped the check the first one makes,
              // which is the donor regression phase 24's required-verifier
              // threading exists to prevent.
              requirements: resolveRequirementsStrict(
                deps.requirements,
                ctx.workUnit.requirementIds,
                ctx.workUnit.id,
              ),
              approvalSeal: await findLatestCriteriaSeal(deps.journal, changeSet.id),
            },
            sessionRef,
            workUnitId: ctx.workUnit.id,
            adjudicate,
            trigger: { kind: "parkResume" },
            runId,
          });
        },
      },
    );
    // `baseObjectId` and `controlDir` are resolved HERE and nowhere else, so the
    // post-completion pipeline integrates against the same frozen base every
    // attempt was cut from rather than re-deriving it.
    return { result, baseObjectId, controlDir };
  }

  /**
   * The run-lifecycle state a settled drive moves the run to, or `undefined`
   * to leave it `running` (ledger run-lifecycle: `running →
   * verifying|failed|blocked|cancelled`).
   *
   * Every outcome that ENDS the run transitions, and this is deliberate: a run
   * left `running` is treated as in-flight by `findLiveRunForChangeSet`, so
   * its change set can never be re-dispatched — the retry-blocking harm this
   * mapping exists to prevent (review F5, and the idle-run wedge below).
   *
   * `failed`/`cancelled` are the drive's own report that every unit reached a
   * terminal status and at least one did not succeed. They arrived
   * 2026-08-02: `driveRun` used to call any all-terminal DAG `completed`, this
   * function correctly wrote nothing for a completion, and an ordinary
   * single-unit failure therefore wedged its run in `running` forever — with
   * `resume` answering `accepted: true` to a re-drive that could dispatch
   * nothing. A failing run raises no verification question, so settling it
   * onto the declared `running → failed`/`running → cancelled` edges needs
   * none of the deferred `verifying` wiring.
   *
   * `completed` NO LONGER stays `running` (2026-08-05). Its successor
   * `verifying` was "owned by the verification pipeline rather than invented
   * here" — and that pipeline did not exist, so no run had ever reached
   * `published_local` and every fully-successful run sat in `running` until an
   * operator cancelled it. `./post-completion-pipeline.ts` is that pipeline;
   * `completed` now hands off to it from `beginDriving`'s settle chain, which is
   * why this function still returns `undefined` for it — the pipeline owns the
   * whole walk INCLUDING its terminal, so there is no single state to return.
   * Defect record: `14-gate-registry-never-composed.md`.
   *
   * `parked` still stays `running`, on unchanged grounds: a parked run is
   * resumable and must stay in-flight for `resume` to reach it.
   */
  function terminalStateFor(stopped: DriveRunResult["stopped"]): RunLifecycleState | undefined {
    switch (stopped) {
      case "blocked":
        return "blocked";
      case "failed":
        return "failed";
      case "cancelled":
        // The run's units were cancelled, not broken — `running → cancelled`
        // is legal, and recording it as a failure would misattribute how the
        // run ended in an audit record nothing else can correct.
        return "cancelled";
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
   * Runs the post-completion pipeline for an all-SUCCEEDED drive, and reports
   * anything short of publication through `onDriveError`.
   *
   * NEVER REJECTS for a pipeline outcome, and rejects for nothing else it can
   * help: this runs on the not-awaited drive chain. A `failed`/`blocked` outcome
   * has already been journaled by the pipeline itself (it owns its own
   * terminals), so there is nothing for `settleRunState` to add — only the
   * operator-facing reason, which is what `onDriveError` carries. A genuine
   * THROW out of the pipeline (a journal write failing, a git binary missing)
   * propagates to `beginDriving`'s own `.catch`, which settles the run `failed`
   * on the legal `verifying|integrating|final_verifying → failed` edge.
   */
  async function runCompletedPipeline(
    runId: string,
    resolved: Extract<ResolvedRun, { ok: true }>,
    driven: DrivenRun,
  ): Promise<void> {
    const worktreePathByUnitId = new Map<string, string>();
    for (const [workUnitId, retained] of retainedByRun.get(runId) ?? []) {
      worktreePathByUnitId.set(workUnitId, retained.worktreePath);
    }

    const outcome = await runPostCompletionPipeline(
      {
        runId,
        changeSet: resolved.changeSet,
        workUnits: resolved.workUnits,
        baseObjectId: driven.baseObjectId,
        statusById: driven.result.statusById,
        worktreePathByUnitId,
      },
      {
        journal: deps.journal,
        runs: deps.runs,
        requirements: deps.requirements,
        workUnitRegistry: deps.workUnits,
        // NOT injectable — see `RealRunDispatcherOptions.postCompletionGitEffects`.
        registry: gateRegistry,
        git:
          options.postCompletionGitEffects ??
          createRealPostCompletionGitEffects({
            plumbing,
            controlDir: driven.controlDir,
            projectDir,
            serviceEmail,
            journal: deps.journal,
          }),
        ...(options.onPostCompletionStep !== undefined
          ? { onStep: options.onPostCompletionStep }
          : {}),
      },
    );

    if (outcome.status === "published") return;
    onDriveError(
      runId,
      new Error(`run "${runId}" did not publish (${outcome.status}): ${outcome.reason}`),
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
    const changeSetId = resolved.changeSet.id;
    // Deliberately NOT awaited — see the file-level doc comment. Errors
    // are reported through `onDriveError`, never left as an unhandled
    // rejection that could take the whole daemon down. The chain IS retained,
    // though: `drain` has to be able to wait for exactly this promise, and
    // "not awaited by the request" is a different thing from "unreachable".
    const settled = drive(runId, resolved.changeSet, resolved.workUnits, resolved.envelope, policy)
      .then(async (driven) => {
        // The run's lifecycle state must reflect how its drive ended, or a
        // failed/blocked run stays `running` and blocks every retry (F5).
        const to = terminalStateFor(driven.result.stopped);
        if (to !== undefined) await settleRunState(runId, changeSetId, to);
        // An all-SUCCEEDED drive hands off to the post-completion pipeline,
        // which owns the rest of the walk to `published_local`. It runs BEFORE
        // `clearRetainedRun` below, because the retained per-run map is where
        // each unit's attempt worktree path lives and the collect step needs it.
        else if (driven.result.stopped === "completed") {
          await runCompletedPipeline(runId, resolved, driven);
        }
        // Retained adapters are kept ONLY while the run is parked (so a later
        // `resume` can continue the session); any other outcome means the run
        // will not resume those sessions, so free them now.
        if (driven.result.stopped !== "parked") clearRetainedRun(runId);
      })
      .catch(async (err: unknown) => {
        onDriveError(runId, err);
        // A drive that threw did not complete — fail the run so the change
        // set is retryable rather than wedged `running`.
        await settleRunState(runId, changeSetId, "failed");
        clearRetainedRun(runId);
      })
      .finally(() => {
        release();
        liveDrives.delete(runId);
      });
    // Registered synchronously: `settled`'s `finally` cannot run before the
    // current tick ends, so the delete above can never outrun this set.
    liveDrives.set(runId, {
      changeSetId,
      workUnitIds: resolved.workUnits.map((unit) => unit.id),
      settled,
    });
  }

  /** Resolves when nothing is in flight. Loops because a drive that settles may be replaced by one a concurrent caller started. */
  async function whenIdle(): Promise<void> {
    while (liveDrives.size > 0) {
      await Promise.allSettled([...liveDrives.values()].map((live) => live.settled));
    }
  }

  /** `true` iff everything went quiet within `ms`. The timer is unref'd and cleared, so it can neither hold the daemon open nor outlive the race. */
  async function settlesWithin(ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([whenIdle().then(() => true), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Drives every live worker of the cut-off runs through the SAME
   * `terminate(graceMs)` closure the control plane's `worker.terminate`
   * operation calls (`run-driver.ts` registers it as the attempt starts and
   * retires it in `finally`), which asks the adapter to cancel with a grace
   * deadline. A worker that refuses to die is not this function's problem to
   * force — it surfaces as an unsettled run, which is a stronger, honest
   * answer than pretending the ladder always wins.
   */
  async function terminateWorkersOf(
    cutOff: ReadonlyMap<string, LiveDrive>,
    graceMs: number,
  ): Promise<void> {
    await Promise.all(
      [...cutOff].flatMap(([runId, live]) =>
        live.workUnitIds.map(async (workUnitId) => {
          const worker = deps.liveWorkers.get(workUnitId);
          if (worker === undefined) return;
          try {
            await worker.terminate(graceMs);
          } catch (err) {
            // Best effort: a terminate that throws must not abort the drain of
            // every other run, and the run it belonged to will be reported
            // unsettled if this really left it writing.
            onDriveError(runId, err);
          }
        }),
      ),
    );
  }

  async function drain(drainOptions?: DrainOptions): Promise<DrainOutcome> {
    // Shut the door FIRST, before the first await: a dispatch admitted while
    // we are waiting would be a drive started after the caller decided the
    // daemon was quiescing.
    draining = true;
    const timeoutMs = drainOptions?.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    const graceMs = drainOptions?.graceMs ?? DEFAULT_DRAIN_GRACE_MS;

    const atEntry = [...liveDrives.keys()];
    if (atEntry.length === 0) return NOTHING_DRAINED;
    if (await settlesWithin(timeoutMs)) {
      return { settledRunIds: atEntry, cancelledRunIds: [], unsettledRunIds: [] };
    }

    // THE DEADLINE. Snapshot before terminating: the entries are removed by
    // the very settle path we are about to provoke, and their changeSetId is
    // the only way to journal the run's end afterwards.
    const cutOff = new Map(liveDrives);
    await terminateWorkersOf(cutOff, graceMs);
    await settlesWithin(graceMs);

    const cancelledRunIds: string[] = [];
    const unsettledRunIds: string[] = [];
    for (const [runId, live] of cutOff) {
      if (liveDrives.has(runId)) {
        // STILL WRITING. Journal nothing for it — a second appender beside a
        // live one is precisely the duplicate-`seq` corruption this whole
        // mechanism exists to prevent, and `appendEntry` has no lock to make
        // it safe. Reporting it is what lets the boot layer keep the lease.
        unsettledRunIds.push(runId);
        continue;
      }
      // Cut off, but quiet now: record how it actually ended. Without this the
      // run stays `running` with every unit terminal — a run nothing can
      // finish, whose change set nothing can re-dispatch, and which restart
      // recovery replays as though a drive were still going.
      await settleRunState(runId, live.changeSetId, "cancelled");
      clearRetainedRun(runId);
      cancelledRunIds.push(runId);
    }

    return {
      settledRunIds: atEntry.filter((runId) => !cutOff.has(runId)),
      cancelledRunIds,
      unsettledRunIds,
    };
  }

  /**
   * Whether re-driving `runId` could accomplish anything — and if not, which
   * of the two dead ends it is in.
   *
   * THE WEDGES THIS ANSWERS, both instances of one lie: `resume` reporting
   * success for a re-drive that cannot dispatch anything, leaving the run
   * `running` and its change set un-dispatchable forever.
   *
   *   - `strandedParks` (PR #46). Park records are durable; the adapters that
   *     own their sessions are not (`retainedByRun` is same-daemon by
   *     construction). After a restart the driver found a parked unit, asked
   *     `resumeParkedUnit` for it, was declined — correctly, resuming into a
   *     read-only fallback session would be worse — and left it parked.
   *   - `terminalDeadEnd`. Every unit already reached a terminal status and at
   *     least one did not succeed. Since 2026-08-02 a drive settles such a run
   *     itself, so this is reached only by a run wedged BEFORE that fix (the
   *     journal replays it `running` across restarts) or one whose settle
   *     write failed. Re-driving it as a covert settle would be the wrong
   *     contract; name the exit instead.
   *
   * PRECEDENCE, preserved exactly from #46: a still-`pending` unit is real
   * work and a parked unit whose adapter IS retained is resumable, so either
   * makes the whole resume worth accepting regardless of what else the run
   * holds. Stranded parks come next. The terminal dead end is last, and an
   * all-SUCCEEDED run is deliberately NOT one of them.
   *
   * An all-SUCCEEDED run in `running` used to be "waiting on the `completed →
   * verifying` wiring, a deferral, not a dead end". Since 2026-08-05 that wiring
   * exists, so re-driving such a run genuinely advances it: `driveRun` reports
   * `completed` again and the settle chain hands off to the post-completion
   * pipeline. Accepting it is now correct for a REASON rather than in lieu of
   * one. A run already INSIDE the pipeline is refused before this function is
   * reached — see `PIPELINE_STAGES`/`midPipelineReason`.
   */
  async function classifyResume(
    runId: string,
    workUnits: readonly WorkUnit[],
  ): Promise<ResumeVerdict> {
    const retained = retainedByRun.get(runId);
    const stranded: string[] = [];
    const notDue: { unitId: string; resetsAt: number | undefined }[] = [];
    const failedIds: string[] = [];
    const cancelledIds: string[] = [];
    let resumable = false;

    for (const unit of workUnits) {
      // The same run-scoped seed `driveRun` itself starts from, so this asks
      // the question the drive is about to answer, not a different one.
      const latest = await getLatestAttemptForRun(deps.journal, unit.id, runId);
      switch (latest?.status ?? unit.attemptStatus) {
        case "pending":
          resumable = true;
          break;
        case "parked:rate_limit":
          if (retained?.has(unit.id) !== true) {
            stranded.push(unit.id);
            break;
          }
          /**
           * A RETAINED adapter is not on its own a reason to re-drive. Until
           * the reset window passes, the drive freezes the repository, finds
           * the unit still limited, and re-parks — measured on the live run
           * 08f1f1dd, where an operator loop polling "parked → resume" cut 214
           * intake freezes and advanced nothing while every reply said
           * `accepted`. The window check belongs HERE, before `beginDriving`,
           * because the freeze happens inside the drive.
           */
          {
            const status = await getParkStatus(deps.journal, unit.id, nowSeconds(), runId);
            if (status.readyToResume) resumable = true;
            else notDue.push({ unitId: unit.id, resetsAt: status.resetsAt });
          }
          break;
        case "cancelled":
          cancelledIds.push(unit.id);
          break;
        case "dispatched":
        // A latest status of `dispatched` at resume ENTRY can only be a prior
        // drive of THIS run that died mid-attempt (a live drive holds the
        // in-flight claim, checked above). `driveRun` seeds exactly that as
        // `failed`; so does this. FALLS THROUGH.
        case "failed":
          failedIds.push(unit.id);
          break;
        case "succeeded":
          break;
      }
    }

    if (resumable) return { kind: "resumable" };
    if (stranded.length > 0) return { kind: "strandedParks", unitIds: stranded };
    // Ordered AFTER `strandedParks`: a run holding both has a unit that will
    // never resume, and telling the operator to wait would be the worse of the
    // two answers.
    if (notDue.length > 0) return { kind: "parkedNotDue", units: notDue };
    if (failedIds.length + cancelledIds.length > 0) {
      return { kind: "terminalDeadEnd", failedIds, cancelledIds };
    }
    return { kind: "resumable" };
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
      // Checked before the claim: a draining daemon takes no new work at all,
      // and admitting one here would start a drive the shutdown sequence has
      // already stopped waiting for.
      if (draining) return { accepted: false, reason: DISPATCHER_DRAINING_REASON };
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
      // Free adapters pinned by runs that were cancelled (or otherwise ended)
      // out-of-band while parked — see `sweepStaleRetention`.
      sweepStaleRetention();

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
    async resume(runId: string): Promise<RunDispatchOutcome> {
      if (draining) return { accepted: false, reason: DISPATCHER_DRAINING_REASON };
      // Free adapters pinned by runs that ended out-of-band while parked.
      sweepStaleRetention();
      const run = deps.runs.get(runId);
      if (run === undefined) {
        return { accepted: false, reason: `unknown run "${runId}"` };
      }
      if (isRunLifecycleAbsorbing(run.runState)) {
        // The sweep above already dropped this run's adapters (it is
        // absorbing); refuse the resume itself.
        return {
          accepted: false,
          reason: `run "${runId}" is ${run.runState} and cannot be resumed`,
        };
      }
      // Mid-pipeline is a THIRD dead end, alongside `classifyResume`'s two — and
      // it is decided from the run's own state rather than from its work units,
      // because every unit already succeeded. See `midPipelineReason`.
      if (PIPELINE_STAGES.includes(run.runState)) {
        return { accepted: false, reason: midPipelineReason(runId, run.runState) };
      }
      // Claimed synchronously, for the same reason `dispatch` does it (F1):
      // an `async` body still runs to its FIRST `await` synchronously, so
      // every guard above and the claim below are one atomic step with respect
      // to the event loop — the property F1's fix depends on. Anything that
      // awaits must therefore stay BELOW this line, and must release.
      if (inFlight.has(run.changeSetId)) {
        return { accepted: false, reason: "run is already being dispatched" };
      }

      const resolved = resolveChangeSet(run.changeSetId);
      if (!resolved.ok) return { accepted: false, reason: resolved.reason };

      // Resume runs the SAME gate. A run that was authorized once must not
      // keep executing under an authorization the owner has since narrowed --
      // otherwise editing the policy would silently fail to bind anything
      // already in flight, and "re-drive after a crash" would become a way
      // around it.
      const gate = resolvePolicyGate(resolved.envelope);
      if (!gate.ok) return { accepted: false, reason: gate.reason };

      inFlight.add(run.changeSetId);
      let released = false;
      const release = (): void => {
        if (!released) {
          released = true;
          inFlight.delete(run.changeSetId);
        }
      };

      // ANSWER HONESTLY BEFORE TAKING OWNERSHIP. A resume that cannot move the
      // run one step must say so and name the exit that works, rather than
      // reporting success to a no-op and leaving the operator to infer it from
      // a run that never changes. Both dead ends are decided by one sweep
      // (`classifyResume`), so their precedence is explicit and neither can
      // drift from what the drive would actually do.
      let verdict: ResumeVerdict;
      try {
        verdict = await classifyResume(runId, resolved.workUnits);
      } catch (err) {
        release();
        throw err;
      }
      if (verdict.kind === "strandedParks") {
        release();
        return {
          accepted: false,
          reason:
            `run "${runId}" cannot be resumed: its remaining work (${verdict.unitIds.join(", ")}) is ` +
            `parked on a rate limit, and the session context needed to continue those sessions ` +
            `did not survive a daemon restart. Nothing else in the run can advance, so waiting ` +
            `will not help — cancel the run (\`crabgic cancel ${runId}\`) and dispatch the ` +
            `change set again.`,
        };
      }
      if (verdict.kind === "terminalDeadEnd") {
        release();
        return {
          accepted: false,
          reason: terminalDeadEndReason(runId, verdict.failedIds, verdict.cancelledIds),
        };
      }
      if (verdict.kind === "parkedNotDue") {
        release();
        return { accepted: false, reason: parkedNotDueReason(runId, verdict.units) };
      }

      beginDriving(runId, resolved, gate.policy, release);
      return { accepted: true };
    },

    drain,
    whenIdle,
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

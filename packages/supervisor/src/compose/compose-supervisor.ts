/**
 * The supervisor daemon composition root — roadmap/05-supervisor-daemon.md
 * §Lifecycle ("started on demand by the CLI (09); exactly one live instance
 * per project") and §"Before this phase ... nothing owns a process, a
 * socket, or a worker; after it, 06 has a real spawn target, 09 has a live
 * protocol to speak." Settled in the phase-23 final-wiring pass that
 * roadmap/09's Risks section deferred it to.
 *
 * This is the ONE place that assembles 05's independently-tested library
 * units into a live daemon. Before it, `buildSupervisorRouter` and
 * `startSupervisorServer` had zero production callers. The sequence, in the
 * order the daemon's own startup requires:
 *
 *   1. resolve all paths from a single `XdgEnv` + `projectHash` (the same
 *      resolution the CLI uses, so both sides agree on the socket path);
 *   2. construct the durable journal (04), the three DURABLE file-backed
 *      registries (changeSets/workUnits/envelopes — an approved DAG is
 *      produced by `run` in the CLI process and must outlive it) and the
 *      three in-memory ones (runs/workers/artifactIndex, which journal
 *      replay genuinely does rebuild);
 *   3. recover run + worker state by replaying the journal for every run it
 *      knows about (`enumerateJournalRunIds` -> `recoverRun`), then formally
 *      reap the orphaned workers that replay surfaced;
 *   4. build the router over one shared `SupervisorDependencies` bundle
 *      (including a live `liveWorkers` map the execution driver, slice D,
 *      populates as it spawns workers);
 *   5. start the UDS control plane over that router.
 *
 * The returned `ComposedSupervisor` exposes both the running server and the
 * exact `SupervisorDependencies` instance — the execution driver must
 * dispatch against the SAME registries/journal/liveWorkers the control
 * plane serves, never a second copy.
 */
import { join } from "node:path";
import {
  createJournalStore,
  resolveJournalDir,
  resolveStateRoot,
  type JournalStore,
  type XdgEnv,
} from "@crabgic/journal";
import {
  AuthorizationEnvelopeSchema,
  ChangeSetSchema,
  RequirementSchema,
  WorkUnitSchema,
  type AuthorizationEnvelope,
  type ChangeSet,
  type Requirement,
  type WorkUnit,
} from "@crabgic/contracts";
import { createFileRegistry } from "../registries/file-registry.js";
import type { PeerAuthOptions } from "../peer-auth/peer-auth-middleware.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { collectReplayedSessionIds, recoverRun } from "../registries/recovery.js";
import {
  reapOrphansAtStartup,
  type OrphanRecoveryHook,
} from "../worker-lifecycle/orphan-reaper.js";
import {
  buildSupervisorRouter,
  type SupervisorDependencies,
  type TerminableWorker,
} from "../router/build-router.js";
import type { RunDispatcher } from "../router/run-dispatcher.js";
import {
  resolveSupervisorRuntimeDir,
  resolveSupervisorSocketPath,
} from "../runtime/xdg-supervisor-layout.js";
import { startSupervisorServer, type SupervisorServer } from "../socket/uds-server.js";

/** Backing files for the three durable registries, under the project's XDG state root. `packages/cli`'s intake wiring writes these exact names. */
export const CHANGE_SETS_FILE_NAME = "change-sets.json";
export const WORK_UNITS_FILE_NAME = "work-units.json";
export const AUTHORIZATION_ENVELOPES_FILE_NAME = "authorization-envelopes.json";
/** Written by the CLI's intake wiring only — the daemon has no read of its own yet; `contract.approve`, served from the gateway MCP process, is the reader. */
export const INTENT_CONTRACTS_FILE_NAME = "intent-contracts.json";
/**
 * The `Requirement` records (roadmap/24). Unlike the contract above, the DAEMON is a reader: seal verification resolves a work unit's requirements before it will accept that unit's completion.
 *
 * Annotation (2026-08-04): that reader now actually exists. Between phase 24 and this date the sentence above described an intent, not the code — this constant was declared here and the file was never opened, so `SupervisorDependencies.requirements` was `undefined` in the shipped daemon and the completion funnel verified zero requirements per unit (defect `24-daemon-requirements-registry-unwired.md`). `composeSupervisor` builds the registry below, and `SupervisorDependencies.requirements` is no longer optional.
 */
export const REQUIREMENTS_FILE_NAME = "requirements.json";

/** A `SupervisorDependencies` whose `liveWorkers` map is mutable — the composition root owns the map so the execution driver (slice D) can register/retire `TerminableWorker` handles as workers spawn and settle. */
export interface ComposedSupervisorDependencies extends SupervisorDependencies {
  readonly liveWorkers: Map<string, TerminableWorker>;
}

export interface ComposeSupervisorConfig {
  /** The XDG environment every path is derived from — the same one the CLI resolves the socket path against. */
  readonly env: XdgEnv;
  /** The project hash scoping this daemon's state root (one live instance per project). */
  readonly projectHash: string;
  /** Peer-auth options for the UDS server; the real `readPeerCredentialsLinux` reader in production, an injected double in tests. */
  readonly peerAuth: PeerAuthOptions;
  /** Resume/fork policy call site for orphaned workers reaped at startup — 13 supplies the real policy; defaults to a no-op (roadmap/05 §Out of scope). */
  readonly onOrphanDetected?: OrphanRecoveryHook;
  /** Observability hook forwarded to the UDS server — a single bad peer connection can never take down the server. */
  readonly onConnectionError?: (err: Error) => void;
  /**
   * Builds the `run.dispatch` driver (roadmap/13's `driveRun`). A FACTORY
   * rather than a value because the dispatcher needs the journal,
   * registries and `liveWorkers` map this function itself creates — the
   * caller cannot construct it in advance.
   *
   * Optional: this package cannot build one (the real driver needs
   * `@crabgic/engine-claude`, which depends on this package), so the daemon
   * entry point in `packages/cli` supplies it. Without it the control
   * plane serves normally and `run.dispatch` refuses.
   */
  readonly createRunDispatcher?: (deps: SupervisorDependencies) => RunDispatcher;
}

export interface ComposedSupervisor {
  /** The running UDS control-plane server. */
  readonly server: SupervisorServer;
  /** The single shared dependency bundle the router serves and the execution driver dispatches against. */
  readonly deps: ComposedSupervisorDependencies;
  /** The env-derived control-plane socket path (`.../supervisor/run/control.sock`). */
  readonly socketPath: string;
  /** The env-derived `0700` runtime dir housing the socket. */
  readonly runtimeDir: string;
  /** The recovered run ids replay rebuilt at startup (may be empty). */
  readonly recoveredRunIds: readonly string[];
  /** The worker ids the startup orphan sweep reaped (may be empty). */
  readonly reapedWorkerIds: readonly string[];
  /** Stops the control plane. Does NOT release any process-level lease — that belongs to the boot layer (slice B). */
  close(): Promise<void>;
}

/**
 * Collects the distinct `runId`s the journal has ever recorded, by scanning
 * every entry through the journal's own public `queryEntries()` iterator
 * (an absent filter yields all entries). On a fresh restart the in-memory
 * registries start empty, so this journal scan is the only source of truth
 * for which runs the daemon must recover.
 */
export async function enumerateJournalRunIds(journal: JournalStore): Promise<readonly string[]> {
  const runIds = new Set<string>();
  for await (const entry of journal.queryEntries()) {
    if (entry.runId !== undefined) {
      runIds.add(entry.runId);
    }
  }
  return Array.from(runIds);
}

/** Assembles and starts the supervisor daemon. See the file-level doc comment for the ordered startup sequence. */
export async function composeSupervisor(
  config: ComposeSupervisorConfig,
): Promise<ComposedSupervisor> {
  const { env, projectHash } = config;

  const journalDir = resolveJournalDir(env, projectHash);
  const stateRoot = resolveStateRoot(env, projectHash);
  const runtimeDir = resolveSupervisorRuntimeDir(env, projectHash);
  const socketPath = resolveSupervisorSocketPath(env, projectHash);

  const journal = createJournalStore({ journalDir });
  const runs = createRunsRegistry();
  // DURABLE (2026-07-25): a ChangeSet, its WorkUnits and the approved
  // envelope are produced by `run` in the CLI process and consumed by
  // `run.dispatch` here, in a different process — and journal replay
  // rebuilds only runs/workers (`../registries/recovery.ts`), so an
  // in-memory registry meant the daemon could never see an approved DAG at
  // all. These three share the exact paths `packages/cli`'s intake wiring
  // writes. `runs`/`workers`/`artifactIndex` stay in-memory on purpose:
  // replay genuinely does rebuild them.
  const changeSets = createFileRegistry<ChangeSet>({
    path: join(stateRoot, CHANGE_SETS_FILE_NAME),
    schema: ChangeSetSchema,
  });
  const workUnits = createFileRegistry<WorkUnit>({
    path: join(stateRoot, WORK_UNITS_FILE_NAME),
    schema: WorkUnitSchema,
  });
  const envelopes = createFileRegistry<AuthorizationEnvelope>({
    path: join(stateRoot, AUTHORIZATION_ENVELOPES_FILE_NAME),
    schema: AuthorizationEnvelopeSchema,
  });
  // The acceptance bar (roadmap/24), read from the file INTAKE wrote at
  // `packages/cli/src/bootstrap.ts` — the same state root, the same constant.
  // A FOURTH durable registry beside the three above, for the same
  // cross-process reason and one stronger: the daemon does not merely display
  // these records, it refuses a completion that does not match them. Omitting
  // it did not fail loudly, it degraded the acceptance bar to empty; that is
  // why the field it feeds is now required rather than optional.
  const requirements = createFileRegistry<Requirement>({
    path: join(stateRoot, REQUIREMENTS_FILE_NAME),
    schema: RequirementSchema,
  });
  const workers = createWorkersRegistry();
  const artifactIndex = createArtifactIndexRegistry();
  const liveWorkers = new Map<string, TerminableWorker>();

  // Step 3: replay the journal for every known run, rebuilding runs + workers.
  const recoveredRunIds = await enumerateJournalRunIds(journal);
  // Which run each replayed session belongs to. Carried through to the reaper
  // so the failed-attempt records it writes are RUN-SCOPED: an attempt with no
  // runId is invisible to `getLatestAttemptForRun`/`recover(runId)`, so the
  // reaper's own verdict used to be unreadable by the driver that acts on it
  // (see `reapOrphansAtStartup`'s `runIdBySessionId`).
  const runIdBySessionId = new Map<string, string>();
  for (const runId of recoveredRunIds) {
    const result = await recoverRun(runId, { journal, runs, workers });
    for (const sessionId of collectReplayedSessionIds(result)) {
      runIdBySessionId.set(sessionId, runId);
    }
  }
  // Formalize the orphaned workers replay surfaced (`crashed` -> journaled
  // failed attempt + recovery-hook call site).
  const reapedWorkerIds = await reapOrphansAtStartup({
    journal,
    workers,
    runIdBySessionId,
    ...(config.onOrphanDetected !== undefined ? { onOrphanDetected: config.onOrphanDetected } : {}),
  });

  const baseDeps: ComposedSupervisorDependencies = {
    journal,
    runs,
    changeSets,
    workUnits,
    envelopes,
    requirements,
    workers,
    artifactIndex,
    liveWorkers,
  };

  // The dispatcher is built FROM the dependency bundle (it needs the same
  // journal, registries and liveWorkers map the router serves), then folded
  // back into it — so `run.dispatch`'s driver and `worker.terminate` share
  // one `liveWorkers`, which is exactly what lets terminate reach a worker
  // the driver spawned.
  const deps: ComposedSupervisorDependencies =
    config.createRunDispatcher !== undefined
      ? { ...baseDeps, runDispatcher: config.createRunDispatcher(baseDeps) }
      : baseDeps;

  const router = buildSupervisorRouter(deps);
  const server = await startSupervisorServer({
    runtimeDir,
    socketPath,
    router,
    peerAuth: config.peerAuth,
    ...(config.onConnectionError !== undefined
      ? { onConnectionError: config.onConnectionError }
      : {}),
  });

  return {
    server,
    deps,
    socketPath,
    runtimeDir,
    recoveredRunIds,
    reapedWorkerIds,
    close: () => server.close(),
  };
}

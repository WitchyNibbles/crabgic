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
 *   2. construct the durable journal (04) and the five in-memory registries
 *      (runs/changeSets/workUnits/workers/artifactIndex) — the registries
 *      are never themselves persisted, only the journal is;
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
import { createJournalStore, resolveJournalDir, type JournalStore, type XdgEnv } from "@eo/journal";
import type { PeerAuthOptions } from "../peer-auth/peer-auth-middleware.js";
import { createRunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { createWorkUnitsRegistry } from "../registries/work-units-registry.js";
import { createWorkersRegistry } from "../registries/workers-registry.js";
import { createArtifactIndexRegistry } from "../registries/artifact-index-registry.js";
import { recoverRun } from "../registries/recovery.js";
import {
  reapOrphansAtStartup,
  type OrphanRecoveryHook,
} from "../worker-lifecycle/orphan-reaper.js";
import {
  buildSupervisorRouter,
  type SupervisorDependencies,
  type TerminableWorker,
} from "../router/build-router.js";
import {
  resolveSupervisorRuntimeDir,
  resolveSupervisorSocketPath,
} from "../runtime/xdg-supervisor-layout.js";
import { startSupervisorServer, type SupervisorServer } from "../socket/uds-server.js";

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
  const runtimeDir = resolveSupervisorRuntimeDir(env, projectHash);
  const socketPath = resolveSupervisorSocketPath(env, projectHash);

  const journal = createJournalStore({ journalDir });
  const runs = createRunsRegistry();
  const changeSets = createChangeSetsRegistry();
  const workUnits = createWorkUnitsRegistry();
  const workers = createWorkersRegistry();
  const artifactIndex = createArtifactIndexRegistry();
  const liveWorkers = new Map<string, TerminableWorker>();

  // Step 3: replay the journal for every known run, rebuilding runs + workers.
  const recoveredRunIds = await enumerateJournalRunIds(journal);
  for (const runId of recoveredRunIds) {
    await recoverRun(runId, { journal, runs, workers });
  }
  // Formalize the orphaned workers replay surfaced (`crashed` -> journaled
  // failed attempt + recovery-hook call site).
  const reapedWorkerIds = await reapOrphansAtStartup({
    journal,
    workers,
    ...(config.onOrphanDetected !== undefined ? { onOrphanDetected: config.onOrphanDetected } : {}),
  });

  const deps: ComposedSupervisorDependencies = {
    journal,
    runs,
    changeSets,
    workUnits,
    workers,
    artifactIndex,
    liveWorkers,
  };

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

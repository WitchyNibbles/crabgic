/**
 * The supervisor daemon's process boot layer — roadmap/05-supervisor-
 * daemon.md §Lifecycle: "started on demand by the CLI (09); exactly one live
 * instance per project, enforced by 04's PID/start-time-validated lease."
 *
 * `composeSupervisor` (`./compose-supervisor.ts`) owns the in-process wiring
 * — journal, registries, recovery, router, UDS server. This layer owns the
 * PROCESS-level concerns around it, in the exact order the daemon's
 * single-instance guarantee requires:
 *
 *   1. acquire the per-project lease FIRST — if another daemon already holds
 *      it, refuse (`SupervisorAlreadyRunningError`) before composing anything;
 *   2. compose + serve — and if composition throws, release the lease so the
 *      project is never left wedged behind a held-but-dead lease;
 *   3. install signal handlers (SIGTERM/SIGINT) that gracefully close the
 *      control plane, DRAIN the run dispatcher, and only then release the
 *      lease.
 *
 * SHUTDOWN ORDER IS A DATA-INTEGRITY PROPERTY, not politeness. `run.dispatch`
 * resolves on ownership and leaves its drive detached (see
 * `../router/run-dispatcher.ts`), and the project lease is the journal's ONLY
 * single-writer guarantee — `appendEntry` takes no lock of its own. This
 * layer used to unregister signals, close the server and release the lease
 * with a live appender still running, so an ordinary SIGTERM mid-run freed
 * the lease, the next CLI call spawned a second daemon that acquired it, and
 * two writers on one hash chain produced the duplicate `seq`/`prevHash` that
 * `repairJournal` classifies as TAMPER rather than a torn tail —
 * `JournalTamperedError` on the next `recover()`. The order is now: stop
 * accepting (close the server) -> `dispatcher.drain(deadline)` -> release the
 * lease LAST, and NOT AT ALL if the drain could not settle a writer. A lease
 * left held by an exiting process is reclaimed safely by the next daemon's
 * PID/start-time takeover; a lease released under a live writer is not
 * reclaimed at all, it is shared.
 *
 * The process-level seams (`registerSignal`/`unregisterSignal`, `onShutdown`,
 * and `compose` itself) are all injectable so the real-process shim
 * (`../bin/supervisord.ts`) stays thin and untested-by-design while every
 * branch here is unit-tested — the same split `packages/cli`'s `bin.ts` uses.
 */
import {
  Lease,
  LeaseHeldError,
  resolveLeasesDir,
  type LeaseAcquireOptions,
} from "@crabgic/journal";
import type { DrainOutcome } from "../router/run-dispatcher.js";
import {
  composeSupervisor,
  type ComposedSupervisor,
  type ComposeSupervisorConfig,
} from "./compose-supervisor.js";

/** Thrown when a daemon is already holding this project's lease — the single-live-instance guarantee. Carries the project hash so the bin can map it to a distinct exit code. */
export class SupervisorAlreadyRunningError extends Error {
  constructor(
    readonly projectHash: string,
    override readonly cause: LeaseHeldError,
  ) {
    super(
      `supervisor: a daemon is already running for project "${projectHash}" (lease held at ${cause.leasePath ?? "the project lease path"})`,
    );
    this.name = "SupervisorAlreadyRunningError";
  }
}

const DEFAULT_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

/**
 * How long a shutdown waits for in-flight drives before terminating their
 * workers. Chosen to sit inside systemd's own 90s `TimeoutStopSec` default
 * with room for the grace window below, so the daemon reaches its own
 * deadline — where it can journal a terminal state and decide about the lease
 * — rather than being SIGKILLed halfway through by the supervisor above it.
 */
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
/** The grace window handed to each live worker at the deadline, and allowed for its drive to unwind afterwards. */
const DEFAULT_DRAIN_GRACE_MS = 5_000;

/** What the shutdown actually did — reported to `onShutdown` so the bin can log the lease decision instead of assuming it. */
export interface SupervisorShutdownInfo {
  readonly signal?: NodeJS.Signals;
  /**
   * Whether the project lease was handed back. `false` means the shutdown
   * could not establish that every writer had stopped — either a drive
   * outlived the drain (`unsettledRunIds`) or the drain itself failed
   * (`drainError`) — so the lease is deliberately left held for the next
   * daemon's PID/start-time takeover. See the file-level doc comment.
   */
  readonly leaseReleased: boolean;
  /** The runs whose drives outlived the drain. */
  readonly unsettledRunIds: readonly string[];
  /**
   * Why the drain could not answer at all, if it could not. The real
   * dispatcher never rejects, but the lazy wrapper's `drain` does when a
   * deferred engine load is still in flight at shutdown and fails. An
   * unanswered drain is treated exactly like an unsettled one: "cannot tell"
   * must never render as "nothing is writing".
   */
  readonly drainError?: unknown;
}

export interface BootSupervisorConfig extends ComposeSupervisorConfig {
  /** The leases directory. Defaults to `resolveLeasesDir(env, projectHash)` — 04's pinned leases subpath. */
  readonly leaseDir?: string;
  /** Lease acquisition options forwarded to `Lease.acquire`. */
  readonly leaseOptions?: LeaseAcquireOptions;
  /** Signals whose delivery triggers a graceful shutdown. Defaults to SIGTERM + SIGINT. */
  readonly signals?: readonly NodeJS.Signals[];
  /** Installs a signal handler. Defaults to `process.on`; injected in tests so no real handler is registered. */
  readonly registerSignal?: (
    signal: NodeJS.Signals,
    handler: (signal: NodeJS.Signals) => void,
  ) => void;
  /** Removes a signal handler. Defaults to `process.off`; injected in tests. */
  readonly unregisterSignal?: (
    signal: NodeJS.Signals,
    handler: (signal: NodeJS.Signals) => void,
  ) => void;
  /** Invoked once, after the control plane is closed, the dispatcher drained and the lease decided. The bin uses it to set the process exit code. */
  readonly onShutdown?: (info: SupervisorShutdownInfo) => void;
  /** Shutdown's wait for in-flight drives before their workers are terminated. Defaults to `DEFAULT_DRAIN_TIMEOUT_MS`; injected in tests so no case waits on a real clock. */
  readonly drainTimeoutMs?: number;
  /** Grace window forwarded to the drain's termination step. Defaults to `DEFAULT_DRAIN_GRACE_MS`. */
  readonly drainGraceMs?: number;
  /** The compose implementation. Defaults to `composeSupervisor`; injected in tests to drive the compose-failure path. */
  readonly compose?: (config: ComposeSupervisorConfig) => Promise<ComposedSupervisor>;
}

export interface BootedSupervisor {
  /** The running control plane (server + shared dependency bundle). */
  readonly composed: ComposedSupervisor;
  /** The held single-instance project lease. */
  readonly lease: Lease;
  /** Gracefully closes the control plane, releases the lease, and de-registers signal handlers. Idempotent — repeated or concurrent calls await the same in-flight shutdown. */
  shutdown(): Promise<void>;
}

/** Boots the supervisor daemon. See the file-level doc comment for the ordered startup/shutdown sequence. */
export async function bootSupervisor(config: BootSupervisorConfig): Promise<BootedSupervisor> {
  const leaseDir = config.leaseDir ?? resolveLeasesDir(config.env, config.projectHash);
  const compose = config.compose ?? composeSupervisor;
  const signals = config.signals ?? DEFAULT_SIGNALS;
  const registerSignal =
    config.registerSignal ?? ((signal, handler) => void process.on(signal, handler));
  const unregisterSignal =
    config.unregisterSignal ?? ((signal, handler) => void process.off(signal, handler));

  // 1. Single-instance lease FIRST — refuse before composing anything.
  let lease: Lease;
  try {
    lease = await Lease.acquire(leaseDir, config.projectHash, config.leaseOptions ?? {});
  } catch (err) {
    if (err instanceof LeaseHeldError) {
      throw new SupervisorAlreadyRunningError(config.projectHash, err);
    }
    throw err;
  }

  // 2. Compose + serve — release the lease if composition throws, so a failed
  //    boot never leaves the project wedged behind a held-but-dead lease.
  let composed: ComposedSupervisor;
  try {
    composed = await compose({
      env: config.env,
      projectHash: config.projectHash,
      peerAuth: config.peerAuth,
      ...(config.onOrphanDetected !== undefined
        ? { onOrphanDetected: config.onOrphanDetected }
        : {}),
      ...(config.createRunDispatcher !== undefined
        ? { createRunDispatcher: config.createRunDispatcher }
        : {}),
      ...(config.onConnectionError !== undefined
        ? { onConnectionError: config.onConnectionError }
        : {}),
    });
  } catch (err) {
    await lease.release();
    throw err;
  }

  // 3. Graceful-shutdown machinery — memoized so a signal + an explicit
  //    shutdown() call converge on one teardown, never two.
  let shutdownPromise: Promise<void> | undefined;
  const runShutdown = async (signal?: NodeJS.Signals): Promise<void> => {
    for (const s of signals) unregisterSignal(s, signalHandler);
    // (a) STOP ACCEPTING. Closing the control plane first means no new
    //     `run.dispatch` can arrive while we are draining the old ones.
    await composed.close();
    // (b) DRAIN. Wait for every detached drive to stop writing to the
    //     journal; at the deadline, terminate its workers and journal the
    //     run's own end. A daemon composed without a dispatcher (the control
    //     plane serves fine without one) has nothing to drain.
    //     A drain that THROWS is caught rather than allowed to escape: this
    //     runs under `void shutdown(signal)` from the signal handler, so an
    //     unhandled rejection here would take out the process AND skip the
    //     lease decision and `onShutdown` entirely. An unanswered drain is
    //     treated as an unsettled one — "cannot tell" must never render as
    //     "nothing is writing".
    let drained: DrainOutcome | undefined;
    let drainError: unknown;
    try {
      drained = await composed.deps.runDispatcher?.drain({
        timeoutMs: config.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
        graceMs: config.drainGraceMs ?? DEFAULT_DRAIN_GRACE_MS,
      });
    } catch (err) {
      drainError = err;
    }
    // (c) RELEASE THE LEASE LAST — and only if nothing is still writing. See
    //     the file-level doc comment: handing a freed lease to the next
    //     daemon while an appender is live is the corruption; leaving it held
    //     by a process that is about to exit is not, because the lease
    //     validates its holder's pid and start time before honouring it.
    const unsettledRunIds = drained?.unsettledRunIds ?? [];
    const leaseReleased = unsettledRunIds.length === 0 && drainError === undefined;
    if (leaseReleased) await lease.release();
    config.onShutdown?.({
      ...(signal !== undefined ? { signal } : {}),
      leaseReleased,
      unsettledRunIds,
      ...(drainError !== undefined ? { drainError } : {}),
    });
  };
  const shutdown = (signal?: NodeJS.Signals): Promise<void> =>
    (shutdownPromise ??= runShutdown(signal));

  function signalHandler(signal: NodeJS.Signals): void {
    void shutdown(signal);
  }

  for (const s of signals) registerSignal(s, signalHandler);

  return {
    composed,
    lease,
    shutdown: () => shutdown(),
  };
}

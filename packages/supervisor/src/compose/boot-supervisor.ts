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
 *      control plane and release the lease on the way down.
 *
 * The process-level seams (`registerSignal`/`unregisterSignal`, `onShutdown`,
 * and `compose` itself) are all injectable so the real-process shim
 * (`../bin/supervisord.ts`) stays thin and untested-by-design while every
 * branch here is unit-tested — the same split `packages/cli`'s `bin.ts` uses.
 */
import { Lease, LeaseHeldError, resolveLeasesDir, type LeaseAcquireOptions } from "@eo/journal";
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
  /** Invoked once, after the control plane is closed and the lease released. The bin uses it to set the process exit code. */
  readonly onShutdown?: (info: { readonly signal?: NodeJS.Signals }) => void;
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
    await composed.close();
    await lease.release();
    config.onShutdown?.(signal !== undefined ? { signal } : {});
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

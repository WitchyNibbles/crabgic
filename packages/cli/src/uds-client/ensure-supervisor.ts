/**
 * Spawn-on-demand supervisor connection — roadmap/05-supervisor-daemon.md
 * §Lifecycle: "started on demand by the CLI (09); exactly one live instance
 * per project". Settled in the phase-23 final-wiring pass (roadmap/09 Risks
 * deferred "the actual composition point" there).
 *
 * `ensureSupervisorConnection` owns the tested policy: connect; if (and only
 * if) the socket is unreachable (`SupervisorUnavailableError`), spawn the
 * daemon ONCE, then retry on a bounded schedule until it answers or the
 * budget is exhausted. Any other error (protocol/handshake/operation) is a
 * live-but-unhappy daemon and propagates untouched — spawning a second
 * daemon could never fix it (and the daemon's own lease would refuse it
 * anyway; `bin/supervisord.ts` treats that refusal as benign, which is what
 * makes concurrent CLI invocations racing this spawn path safe).
 *
 * `spawnSupervisorDaemon` is the real spawner: detached
 * `engineering-orchestrator-supervisord` (resolved inside `@eo/supervisor`'s
 * own package — never a PATH lookup), project hash handed over via
 * `EO_PROJECT_HASH` per the bin's contract, stdio ignored, unref'd so the
 * CLI process can exit while the daemon lives on.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { SupervisorUnavailableError } from "../errors.js";
import type { UdsClient } from "./client.js";

const DEFAULT_MAX_ATTEMPTS = 25;
const DEFAULT_RETRY_DELAY_MS = 200;

export interface EnsureSupervisorConnectionOptions {
  /** Attempts one connection to the project socket. Must throw `SupervisorUnavailableError` (and only that) when no daemon is serving it. */
  readonly connect: () => Promise<UdsClient>;
  /** Starts the daemon process. Called at most once per `ensureSupervisorConnection` call. A throw (e.g. the binary is missing) propagates to the caller. */
  readonly spawnDaemon: () => void;
  /** Total connection attempts (the initial one included). Default 25. */
  readonly maxAttempts?: number;
  /** Delay between retries while the spawned daemon comes up. Default 200ms. */
  readonly retryDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Connects to the supervisor, spawning it on demand. See the file-level doc comment for the policy. */
export async function ensureSupervisorConnection(
  options: EnsureSupervisorConnectionOptions,
): Promise<UdsClient> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let spawned = false;
  let lastUnavailable: SupervisorUnavailableError;

  for (let attempt = 1; ; attempt++) {
    try {
      return await options.connect();
    } catch (err) {
      if (!(err instanceof SupervisorUnavailableError)) throw err;
      lastUnavailable = err;
    }

    if (attempt >= maxAttempts) throw lastUnavailable;

    if (!spawned) {
      options.spawnDaemon();
      spawned = true;
    }
    await delay(retryDelayMs);
  }
}

export interface SpawnSupervisorDaemonOptions {
  readonly projectHash: string;
}

/**
 * The real daemon spawner — a thin, real-process shim (like `../bin.ts`,
 * untested-by-design; the retry/spawn POLICY above carries the tested
 * branches). Resolves the daemon entry point through `@eo/supervisor`'s own
 * `./bin/supervisord.js` export (so this side never hard-codes that package's
 * `dist` layout, and an unbuilt/missing daemon surfaces as a loud
 * `MODULE_NOT_FOUND` rather than a silent spawn of a nonexistent path), then
 * runs it under the current `node` (`process.execPath`), detached with stdio
 * ignored, and unref'd so the CLI can exit while the daemon lives on.
 */
export function spawnSupervisorDaemon(options: SpawnSupervisorDaemonOptions): void {
  const require = createRequire(import.meta.url);
  const supervisordBin = require.resolve("@eo/supervisor/bin/supervisord.js");

  const child = spawn(process.execPath, [supervisordBin], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, EO_PROJECT_HASH: options.projectHash },
  });
  child.unref();
}

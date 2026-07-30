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
 * `crabgic-supervisord` (resolved inside `@crabgic/supervisor`'s
 * own package — never a PATH lookup), project hash handed over via
 * `CRABGIC_PROJECT_HASH` per the bin's contract, stdio ignored, unref'd so the
 * CLI process can exit while the daemon lives on.
 */
import { spawn } from "node:child_process";
import { closeSync, constants, existsSync, ftruncateSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openOwnedFile } from "@crabgic/journal";
import { SupervisorUnavailableError } from "../errors.js";
import { sanitizeForTerminal } from "../output/sanitize.js";
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
  /**
   * Whether an unreachable socket may start a daemon. Default `true` — the
   * spawn-on-demand policy roadmap/05 §Lifecycle describes.
   *
   * Set `false` for PASSIVE callers: read-only observers that want to know
   * whether a supervisor is already running and must not cause one to exist.
   * The manager Stop hook is the motivating case — it runs on every session
   * end, including in projects with no Crabgic run at all, where spawning a
   * daemon would be a surprising side effect and the retry budget would stall
   * the turn for seconds to learn what one failed connect already proves.
   *
   * Passive mode makes exactly one attempt: with no spawn, there is nothing a
   * retry could be waiting for.
   */
  readonly spawn?: boolean;
  /**
   * Reads the tail of whatever the daemon spawned by THIS call wrote to
   * stderr (see `readSupervisordStderrTail`), consulted only once the retry
   * budget is exhausted after a spawn — the one situation where "unreachable"
   * is really "the daemon died, and here is what it said". Never consulted on
   * success, in passive mode, or when nothing was spawned; a throw from the
   * reader is swallowed so a broken log file can never mask the real error.
   */
  readonly readSpawnDiagnostics?: () => string | undefined;
}

/**
 * The bounded wait between connection attempts, and the one place this
 * module's process-liveness contract lives.
 *
 * The timer is deliberately **ref'd**. It used to be `unref()`'d, which is
 * correct for a background heartbeat and wrong for this: in a one-shot CLI
 * process nothing else holds the event loop open across a retry — the
 * spawned daemon is detached and `unref()`'d (`spawnSupervisorDaemon`
 * below) and the failed connect has already closed its socket. Node
 * therefore drained the loop mid-retry and exited **0 with no output**, so
 * `status`/`resume`/`cancel` silently no-op'd whenever the daemon was not
 * already up, rather than reporting `SupervisorUnavailableError`. Observed
 * live at 1.3.0; see this module's test for the full note.
 *
 * Holding the loop cannot hang a process: the loop above is bounded by
 * `maxAttempts`, so the total wait is at most
 * `(maxAttempts - 1) * retryDelayMs` — 4.8s at the defaults.
 *
 * Exported (with its timer handle) purely so that contract is assertable;
 * it has no other caller.
 */
export function retryDelay(ms: number): {
  readonly promise: Promise<void>;
  readonly timer: NodeJS.Timeout;
} {
  let timer!: NodeJS.Timeout;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, timer };
}

/** Connects to the supervisor, spawning it on demand. See the file-level doc comment for the policy. */
export async function ensureSupervisorConnection(
  options: EnsureSupervisorConnectionOptions,
): Promise<UdsClient> {
  const maySpawn = options.spawn ?? true;
  // Passive mode collapses the retry budget to a single attempt: retries exist
  // only to wait out a daemon we started, and passive mode never starts one.
  const maxAttempts = maySpawn ? Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) : 1;
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

    if (attempt >= maxAttempts) {
      if (spawned && options.readSpawnDiagnostics !== undefined) {
        let tail: string | undefined;
        try {
          tail = options.readSpawnDiagnostics();
        } catch {
          tail = undefined;
        }
        if (tail !== undefined) {
          throw new SupervisorUnavailableError(lastUnavailable.causeText, tail);
        }
      }
      throw lastUnavailable;
    }

    if (!spawned) {
      options.spawnDaemon();
      spawned = true;
    }
    await retryDelay(retryDelayMs).promise;
  }
}

/** The pinned stderr-log file name, a sibling of the project's state-root registries. */
export const SUPERVISORD_STDERR_LOG_FILE_NAME = "supervisord.stderr.log";

/**
 * The tail of the spawned daemon's stderr log — `undefined` when the file is
 * missing, refused, or holds nothing but whitespace, so callers can treat "no
 * diagnostics" as one case. Bounded to `maxBytes` from the END of the file:
 * the dying words are the last ones.
 *
 * Opened through `openOwnedFile` for the same reason the write side is: a
 * planted FIFO here would block a synchronous read with no timer able to see
 * it. The contents are sanitized because any same-uid process can write this
 * file and its tail is spliced into a message printed to the operator's
 * terminal — the one surface this system's approval gate trusts.
 */
export function readSupervisordStderrTail(path: string, maxBytes = 4096): string | undefined {
  const opened = openOwnedFile(path, constants.O_RDONLY);
  if (opened.fd === undefined) return undefined;
  let raw: Buffer;
  try {
    raw = readFileSync(opened.fd);
  } catch {
    return undefined;
  } finally {
    closeSync(opened.fd);
  }
  const tail = sanitizeForTerminal(
    raw
      .subarray(Math.max(0, raw.length - maxBytes))
      .toString("utf8")
      .trim(),
  ).trim();
  return tail.length === 0 ? undefined : tail;
}

export interface SpawnSupervisorDaemonOptions {
  readonly projectHash: string;
  /** The repository checkout the daemon will freeze and cut worktrees from. Defaults to the spawning CLI's own cwd, which is already inside the project. */
  readonly projectDir?: string;
  /**
   * When set, the daemon's stderr is written here (truncated per spawn, mode
   * 0600) instead of discarded, so `readSupervisordStderrTail` can surface a
   * startup fatal to the user. Spawning never fails over logging: an
   * unopenable path silently falls back to discarding stderr, exactly the
   * pre-2026-07-29 behaviour. Truncation means the file only ever holds the
   * LATEST spawn's output — a benign concurrent spawn (whose lease refusal
   * exits cleanly) can overwrite a crashed first daemon's message; that
   * residual is accepted because diagnostics are only read when NO daemon
   * ended up serving the socket at all.
   */
  readonly stderrLogPath?: string;
}

/**
 * The real daemon spawner — a thin, real-process shim (like `../bin.ts`,
 * untested-by-design; the retry/spawn POLICY above carries the tested
 * branches). `../bin/supervisord.ts` is this same package's second bin entry
 * (it lives here, not in `@crabgic/supervisor`, because the daemon constructs the
 * real `ClaudeEngineAdapter` and `@crabgic/engine-claude` already depends on
 * `@crabgic/supervisor` — hosting it there would be a dependency cycle), so the
 * daemon is resolved as a plain sibling of this file's own built location
 * rather than through any package resolution. It is then run under the
 * current `node` (`process.execPath`), detached with stdio ignored, and
 * unref'd so the CLI can exit while the daemon lives on.
 */
/**
 * Where the daemon entry actually is, in whichever layout this module is
 * running from.
 *
 * SHIPPED BUG, found 2026-07-30 by running the built binary (the diagnostics
 * added the day before are what made it visible instead of a silent
 * "unreachable"). This resolved ONE candidate, `../bin/supervisord.js`, which
 * is correct for the `tsc` layout — `dist/uds-client/ensure-supervisor.js` is
 * one directory below `dist/bin/`. The PUBLISHED package is bundled, and
 * esbuild splitting puts this code in `dist/chunk-*.js` at the dist root, so
 * `../bin/…` resolved to `packages/cli/bin/supervisord.js`: a path that has
 * never existed. Every daemon spawn in the published binary therefore died
 * with MODULE_NOT_FOUND, which `stdio: "ignore"` swallowed, so `run`'s
 * dispatch, `status`, `resume` and `cancel` all reported a generic
 * unreachable socket instead.
 *
 * This is the same failure class the plugin-asset copy already carries a note
 * about ("shipped broken in 1.0.0... the smoke check missed it by probing only
 * the argument parser, never a real command"): the bundled layout is not the
 * source layout, and only running the real artifact finds it. Both candidates
 * are checked, and `scripts/check-install-smoke.mjs` now asserts the resolved
 * path exists inside a real installed tarball.
 */
export function resolveSupervisordBin(moduleUrl: string = import.meta.url): string {
  const candidates = [
    // Bundled layout: this code sits at the dist root, beside `bin/`.
    new URL("./bin/supervisord.js", moduleUrl),
    // `tsc` layout: this file is at `dist/uds-client/`, one below `dist/bin/`.
    new URL("../bin/supervisord.js", moduleUrl),
  ].map((url) => fileURLToPath(url));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `crabgic: the supervisor daemon entry point was not found. Looked in:\n` +
        candidates.map((candidate) => `  ${candidate}`).join("\n") +
        `\nThis is a packaging fault, not a configuration one — please report it.`,
    );
  }
  return found;
}

export function spawnSupervisorDaemon(options: SpawnSupervisorDaemonOptions): void {
  const supervisordBin = resolveSupervisordBin();

  // Through `openOwnedFile`, never a bare `openSync(path, "w")`. Adversarial
  // review reproduced both hazards of the naive form: a FIFO planted at this
  // path blocks the spawn forever inside a synchronous `open(2)` (no timer,
  // no output — the same failure a roast round already fixed in the policy
  // store), and a symlink truncates whatever it points at, which in this
  // directory means the standing policy, the registries, or the signing key.
  // `O_TRUNC` is not passed (the primitive refuses it by construction, since
  // truncating before the checks would defeat them); the descriptor is
  // truncated below, once it is known to be a regular file this account owns.
  let stderrFd: number | undefined;
  if (options.stderrLogPath !== undefined) {
    const opened = openOwnedFile(options.stderrLogPath, constants.O_WRONLY | constants.O_CREAT, {
      requirePrivateMode: true,
      createMode: 0o600,
    });
    if (opened.fd !== undefined) {
      try {
        // Only this spawn's output, and only readable by its owner even if the
        // file predates a stricter umask.
        ftruncateSync(opened.fd, 0);
        stderrFd = opened.fd;
      } catch {
        closeSync(opened.fd);
        stderrFd = undefined;
      }
    }
  }
  try {
    const child = spawn(process.execPath, [supervisordBin], {
      detached: true,
      stdio: ["ignore", "ignore", stderrFd ?? "ignore"],
      env: {
        ...process.env,
        CRABGIC_PROJECT_HASH: options.projectHash,
        // The daemon drives runs (`run.dispatch`), which means freezing the
        // repository and creating per-attempt worktrees — both need the
        // actual checkout path. A project HASH cannot locate a repository, so
        // the spawning CLI, which is already running inside it, passes it.
        CRABGIC_PROJECT_DIR: options.projectDir ?? process.cwd(),
      },
    });
    child.unref();
  } finally {
    // The child holds its own copy of the descriptor; this one is the
    // parent's and would otherwise leak once per spawn.
    if (stderrFd !== undefined) closeSync(stderrFd);
  }
}

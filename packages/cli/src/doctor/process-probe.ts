/**
 * Injectable process-spawn probe — shared shape every doctor check that
 * shells out (`claude --version`, `bwrap --version`, `git --version`)
 * depends on, mirroring `packages/git-engine`'s own `GitSpawnFn` seam
 * (argv-array only, no shell, real implementation vs. a test double). Kept
 * local to this package rather than importing `@crabgic/git-engine` — this
 * phase has no dependency edge on 07, and the seam itself is a handful of
 * lines, not worth a cross-package import for.
 *
 * `cwd`/`env` are first-class on the probe signature (adversarial-review
 * fix, 2026-07-24): a probe that spawns `claude` to check hermeticity is
 * meaningless if it can't actually run inside an isolated scratch dir with
 * an isolated `CLAUDE_CONFIG_DIR` — see `./checks/hermeticity-selftest.ts`'s
 * own doc comment for the concrete case this fixes.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface ProbeResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ProcessProbeOptions {
  /** Working directory the spawned process runs in. Omitted = inherit this process's own cwd. */
  readonly cwd?: string;
  /**
   * REPLACES the spawned process's entire environment when supplied (never
   * merged with `process.env`) — a check that needs isolation (e.g.
   * hermeticity) must pass a fully-built, explicitly-allowlisted env of its
   * own, exactly like `docs/engine-baseline.md` §2's own probe methodology
   * ("a strictly allowlisted, from-scratch env"). Omitted = inherit this
   * process's own `process.env`.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Wall-clock ceiling. Omitted = wait forever.
   *
   * Roast round 21, finding 3: a SIGKILL landing inside bwrap's ~0-1ms setup
   * window races `--die-with-parent`'s `PR_SET_PDEATHSIG`, and the in-namespace
   * child can survive holding the stdout pipe -- so Node's `close` never fires
   * and `check.run()` never settles. Measured 2/12 hangs at 0ms, with `ps`
   * showing stuck `bwrap` processes 20+ minutes later. `crabgic doctor` hung
   * with no output and no way to know why.
   *
   * On expiry the child's whole PROCESS GROUP is SIGKILLed and the probe
   * RESOLVES with `exitCode: -1` and whatever output arrived.
   *
   * Round 22: killing the direct child alone was not enough. `sh -c "sleep 1;
   * ..."` forks, so the SIGKILL hit `sh` while the grandchild survived holding
   * the probe's stdout/stderr pipes — `close` never fired, both `PipeWrap`
   * handles stayed ref'd, and the hang was not removed but RELOCATED to process
   * exit (`bin.ts` sets `process.exitCode` and relies on a natural exit).
   * Measured: `node` still alive at 12s, `activeResources: [PipeWrap, PipeWrap,
   * Timeout]`. Round 21's own test file orphaned two `sleep 300` processes per
   * run. Supplying `timeoutMs` therefore makes the child a group leader, so the
   * kill reaches the tree; the streams are destroyed as a backstop for anything
   * that escapes the group. That lands in the "never reported
   * running" branch -- UNVERIFIED, never a pass -- which is the fail-closed
   * direction: a check that timed out has not demonstrated confinement.
   */
  readonly timeoutMs?: number;
}

/** Injectable seam: real spawn, or a fixture double for a seeded fault (roadmap/09 §Test plan: "each fixture is seeded before its check is registered and must fail red first"). */
export type ProcessProbeFn = (
  command: string,
  args: readonly string[],
  options?: ProcessProbeOptions,
) => Promise<ProbeResult>;

/**
 * SIGKILL the child's entire process group, falling back to the child alone.
 *
 * `process.kill(-pid)` addresses the group, which only exists because `spawn`
 * was given `detached: true`. It can still throw — ESRCH if everything already
 * exited, EPERM in constrained environments — and a bare child kill is strictly
 * better than nothing there. The streams are destroyed either way: a grandchild
 * that somehow escapes the group must not be able to hold the event loop open,
 * which is the failure this exists to prevent.
 */
function killProcessTree(child: ChildProcess): void {
  // Round 23: the group kill is gated on the child NOT having been reaped.
  // The dangerous window is precisely when `close` has not fired but the child
  // has exited — a descendant outside the group holds the pipes, the child's
  // group is empty, and the kernel is free to recycle the pid. Constructed
  // inside a PID namespace by writing `ns_last_pid`: `process.kill(-pid)`
  // SIGKILLed an unrelated `sleep 400` that had inherited the number. Poorly
  // exploitable on a real host (it needs a group-escaping descendant plus a
  // full pid wrap inside the ceiling) but the state is observable here for
  // free, and the bare-child fallback already covers the reaped case.
  const reaped = child.exitCode !== null || child.signalCode !== null;
  try {
    if (child.pid !== undefined && !reaped) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone; the streams are still destroyed below.
    }
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

/**
 * Detached children currently running under a ceiling.
 *
 * Round 23, finding 1: `detached: true` makes a child a process-group leader,
 * so it is NOT in the terminal's foreground group and never receives SIGINT.
 * Measured end-to-end — SIGINT to `crabgic doctor`'s group with a `bwrap` whose
 * `--version` hangs left the probe alive and reparented to init, while the same
 * run with `detached` removed left nothing behind. Real bwrap's
 * `--die-with-parent` masks this for the confinement probe, but the presence
 * probe carries no such flag, and any non-real `bwrap` escapes both.
 *
 * The group kill lived only in a timer, and a timer dies with the CLI. So the
 * groups are tracked and killed on the way out too.
 */
const liveDetachedChildren = new Set<ChildProcess>();
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let signalHandlersInstalled = false;

function killAllDetachedChildren(): void {
  for (const child of liveDetachedChildren) killProcessTree(child);
  liveDetachedChildren.clear();
}

function installSignalHandlersOnce(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      killAllDetachedChildren();
      // Restore the default disposition and re-raise, so the CLI still dies
      // the way the user asked it to rather than silently absorbing Ctrl-C.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
  // A normal exit path must not strand a group either.
  process.on("exit", killAllDetachedChildren);
}

/** Exposed for tests: the tracked set must not grow without bound. */
export function liveDetachedChildCountForTest(): number {
  return liveDetachedChildren.size;
}

/** Exposed for tests: the reaped-child branch cannot be reached deterministically otherwise. */
export const killProcessTreeForTest = killProcessTree;

export function createRealProcessProbe(): ProcessProbeFn {
  return (command, args, options) =>
    new Promise<ProbeResult>((resolve) => {
      // ONE decision, used by both the spawn option and the registry below.
      // Round 23 found that making `detached` unconditional left the suite
      // green: an unbounded child would then lead its own group (surviving
      // Ctrl-C) while never being registered for the signal sweep, which is
      // the worst of both. They cannot drift now.
      const detached = options?.timeoutMs !== undefined;
      const child = spawn(command, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // Only when a ceiling was asked for: a group leader is what makes the
        // expiry kill reach the whole tree. Without a ceiling the previous
        // (attached) behaviour is preserved exactly.
        ...(detached ? { detached: true } : {}),
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options?.env !== undefined ? { env: options.env } : {}),
      });
      if (detached) {
        liveDetachedChildren.add(child);
        installSignalHandlersOnce();
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      const settle = (result: ProbeResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        liveDetachedChildren.delete(child);
        resolve(result);
      };
      const timer =
        options?.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              killProcessTree(child);
              settle({
                stdout,
                stderr:
                  stderr +
                  `\n[probe timed out after ${String(options.timeoutMs)}ms and was killed]`,
                exitCode: -1,
              });
            }, options.timeoutMs);
      // Do not hold the event loop open on the timer alone.
      timer?.unref?.();
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        settle({ stdout, stderr: err.message, exitCode: -1 });
      });
      child.on("close", (code) => {
        settle({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
}

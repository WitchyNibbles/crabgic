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
  // Round 24 REVERTED round 23's reaped gate, and the reasoning it rested on.
  //
  // Round 23 argued the group kill was unsafe on a reaped child because its pid
  // could be recycled, and reasoned that the case needed "a descendant OUTSIDE
  // the group". That was wrong, and it is the commoner case that suffers: any
  // child that forks and exits — `sh -c 'x & exit'`, a wrapper script, a shim —
  // is reaped while the grandchild INSIDE the group holds the pipes. The gate
  // then skipped the kill entirely and the survivor lived on. Measured with the
  // same grandchild under the same 400ms ceiling, the only difference being
  // whether `sh` had already exited:
  //
  //   child reaped,  grandchild in group -> survivor wrote its witness 2s later
  //   child alive,   grandchild in group -> survivor killed
  //
  // That is round 22's finding 1 verbatim. The hazard traded away needs a full
  // pid wrap inside the ceiling (~40s of churn measured, against a 30s and a
  // 10s ceiling) AND the recycled pid to become a group leader; the hazard
  // traded for needs one fork. `close` not having fired is exactly the state in
  // which survivors may still hold the pipes, and that is when this runs.
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
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
// SIGQUIT is keyboard-generated from the terminal exactly like SIGINT (Ctrl-\),
// and round 24 measured it as the one interactive signal that still orphaned the
// probe child. SIGKILL cannot be caught and is unavoidable.
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;
let signalHandlersInstalled = false;
const installedHandlers: ((...args: unknown[]) => void)[] = [];

function killAllDetachedChildren(): void {
  for (const child of liveDetachedChildren) killProcessTree(child);
  liveDetachedChildren.clear();
}

function installSignalHandlersOnce(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const signal of FORWARDED_SIGNALS) {
    // Round 26: whether we own termination is decided HERE, once, and not from
    // a listener count at handler time. `boot-supervisor.ts` — the file round
    // 24's comment cites by name — de-registers its own listener as the FIRST
    // synchronous statement of its shutdown, so by the time our handler ran the
    // count was back to 1 and we killed the process inside their in-flight
    // teardown. Measured with one bounded probe as the only difference:
    // `rc=143, gracefulShutdownCompleted=0` — the lease held and the socket
    // open, which is the defect round 24 believed it had fixed.
    //
    // A snapshot is correct for both measured shapes: in the CLI nobody else is
    // listening, so we must re-raise or Ctrl-C would be swallowed; in the daemon
    // someone was already listening at boot, so termination is theirs to decide
    // and we only sweep.
    const ownsTermination = process.listenerCount(signal) === 0;
    const handler = (): void => {
      killAllDetachedChildren();
      // Round 24: this used to call `process.removeAllListeners(signal)`, which
      // destroyed EVERY other listener and then killed the process
      // synchronously inside the same emission — so any other handler's async
      // shutdown was aborted mid-flight, whether it had registered before us or
      // after. Measured with one bounded probe as the only difference:
      // `gracefulShutdownCompleted: true` became `false`.
      // `boot-supervisor.ts` registers exactly that shape (`await
      // composed.close(); await lease.release()`), so a SIGTERM would have left
      // the lease held and the socket open the moment the daemon ran a bounded
      // probe. Only OUR listener is removed, and the signal is re-raised only
      // when nobody else is handling it — otherwise theirs decides how to exit.
      // Round 25: `process.off` ran UNCONDITIONALLY, and `signalHandlersInstalled`
      // is a sticky module flag, so a process that SURVIVES the signal — which
      // this guard exists to allow — lost the sweep permanently. Measured with a
      // daemon whose SIGHUP handler reloads rather than exits: probe #1's child
      // was swept, and probe #2, started after the first SIGHUP, survived the
      // second. So the handler is removed ONLY on the path that ends the process.
      if (ownsTermination) {
        process.off(signal, handler);
        process.kill(process.pid, signal);
      }
    };
    process.on(signal, handler);
    installedHandlers.push(handler as (...args: unknown[]) => void);
  }
  // A normal exit path must not strand a group either.
  process.on("exit", killAllDetachedChildren);
}

/**
 * Exposed for tests: tear down the module-level signal registration.
 *
 * `ownsTermination` is snapshotted at INSTALL time, and installation happens
 * once per process, so a test cannot otherwise exercise the "somebody else was
 * already listening" branch — whichever test ran first fixed the answer for
 * every later one. Round 26's own regression test needs to control that order.
 */
export function resetSignalHandlersForTest(): void {
  for (const signal of FORWARDED_SIGNALS) {
    for (const listener of installedHandlers) process.off(signal, listener);
  }
  installedHandlers.length = 0;
  signalHandlersInstalled = false;
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

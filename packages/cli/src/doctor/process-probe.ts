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

export function createRealProcessProbe(): ProcessProbeFn {
  return (command, args, options) =>
    new Promise<ProbeResult>((resolve) => {
      const child = spawn(command, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // Only when a ceiling was asked for: a group leader is what makes the
        // expiry kill reach the whole tree. Without a ceiling the previous
        // (attached) behaviour is preserved exactly.
        ...(options?.timeoutMs !== undefined ? { detached: true } : {}),
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options?.env !== undefined ? { env: options.env } : {}),
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const settle = (result: ProbeResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
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

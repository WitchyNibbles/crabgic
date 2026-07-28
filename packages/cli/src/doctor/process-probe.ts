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
   * On expiry the child is SIGKILLed and the probe RESOLVES with `exitCode:
   * -1` and whatever output arrived. That lands in the "never reported
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

export function createRealProcessProbe(): ProcessProbeFn {
  return (command, args, options) =>
    new Promise<ProbeResult>((resolve) => {
      const child = spawn(command, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
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
              child.kill("SIGKILL");
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

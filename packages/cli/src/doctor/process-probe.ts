/**
 * Injectable process-spawn probe — shared shape every doctor check that
 * shells out (`claude --version`, `bwrap --version`, `git --version`)
 * depends on, mirroring `packages/git-engine`'s own `GitSpawnFn` seam
 * (argv-array only, no shell, real implementation vs. a test double). Kept
 * local to this package rather than importing `@eo/git-engine` — this
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
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        resolve({ stdout, stderr: err.message, exitCode: -1 });
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
}

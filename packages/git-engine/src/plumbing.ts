/// <reference types="node" />
/**
 * Plumbing wrapper — roadmap/07-git-control-repo-worktrees.md work item 1:
 * "spawned `git` (argv-array only, no shell interpolation) + version
 * probe. Reused by 08 for its own `git merge-tree`/`git update-ref` calls
 * rather than a second spawn implementation."
 *
 * CORE SECURITY PROPERTY (this phase's, per the roadmap's Risks section):
 * `git` is invoked via `node:child_process.spawn` with an argv array and
 * the shell option explicitly disabled — this option is never enabled,
 * and no string concatenation into a command line ever occurs. A
 * path/branch/ref containing shell metacharacters reaches `git` as ONE
 * literal argv element. See
 * `./plumbing.test.ts` (the argv-injection corpus) and
 * `./spawn-surface-scan.test.ts` (the structural, non-test-absence static
 * check this package's last exit criterion requires).
 *
 * `GitSpawnFn` is an injectable seam: `createNodeGitSpawn()` is the real,
 * process-spawning implementation; tests inject a capturing fake instead
 * (the roadmap's "spawn-capture shim") to assert on the exact
 * `GitSpawnRequest` this module issues, without needing to intercept
 * `node:child_process` itself.
 */

import { spawn } from "node:child_process";

export interface GitSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface GitSpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type GitSpawnFn = (request: GitSpawnRequest) => Promise<GitSpawnResult>;

export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stderrOutput: string;

  constructor(args: readonly string[], exitCode: number, stderrOutput: string) {
    super(`git ${args.join(" ")} exited with code ${exitCode}: ${stderrOutput.trim()}`);
    this.name = "GitCommandError";
    this.args = args;
    this.exitCode = exitCode;
    this.stderrOutput = stderrOutput;
  }
}

/**
 * The real, process-spawning `GitSpawnFn`. `request.args` is passed to
 * `node:child_process.spawn` AS AN ARRAY — never joined into a string —
 * and the shell option is explicitly disabled below (never omitted, never
 * enabled), so a metacharacter-laden argv element is delivered to the
 * `execve()` syscall verbatim, with no shell ever in the invocation path.
 */
export function createNodeGitSpawn(): GitSpawnFn {
  return (request) =>
    new Promise<GitSpawnResult>((resolve, reject) => {
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env === undefined ? process.env : { ...process.env, ...request.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
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
        reject(err);
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
}

export interface GitRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** When true, a non-zero exit resolves with the raw result instead of throwing `GitCommandError`. */
  readonly allowFailure?: boolean;
}

export interface GitPlumbingOptions {
  /** Injectable for tests ("spawn-capture shim"); defaults to `createNodeGitSpawn()`. */
  readonly spawnFn?: GitSpawnFn;
  readonly gitBinary?: string;
}

export interface GitPlumbing {
  readonly gitBinary: string;
  /** Runs `git <args>` with argv-array-only invocation (no shell). Throws `GitCommandError` on non-zero exit unless `allowFailure` is set. */
  run(args: readonly string[], options?: GitRunOptions): Promise<GitSpawnResult>;
  /** `git --version`, trimmed (e.g. `"git version 2.43.0"`). */
  version(): Promise<string>;
}

export function createGitPlumbing(options: GitPlumbingOptions = {}): GitPlumbing {
  const spawnFn = options.spawnFn ?? createNodeGitSpawn();
  const gitBinary = options.gitBinary ?? "git";

  return {
    gitBinary,
    async run(args, runOptions = {}) {
      const request: GitSpawnRequest = {
        command: gitBinary,
        args,
        ...(runOptions.cwd !== undefined ? { cwd: runOptions.cwd } : {}),
        ...(runOptions.env !== undefined ? { env: runOptions.env } : {}),
      };
      const result = await spawnFn(request);
      if (result.exitCode !== 0 && runOptions.allowFailure !== true) {
        throw new GitCommandError(args, result.exitCode, result.stderr);
      }
      return result;
    },
    async version() {
      const result = await this.run(["--version"]);
      return result.stdout.trim();
    },
  };
}

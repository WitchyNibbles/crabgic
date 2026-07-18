/**
 * Git identity — roadmap/07-git-control-repo-worktrees.md work item 8:
 * "per-worktree `user.name \"Engineering Orchestrator\"` + configured
 * service email, set at worktree-creation time — every commit a worker
 * makes already carries it before 08 ever inspects the tree." Called
 * internally by `./worktree-lifecycle.js`'s `createWorktree` (WI6) so no
 * caller ever needs to invoke this separately; also directly testable on
 * its own (`./git-identity.test.ts`).
 *
 * Local (`--local`) only — NEVER touches global git config, matching this
 * package's "never touches the user's checkout" posture at the config
 * layer too.
 *
 * CONCURRENCY NOTE (found by this phase's own "many concurrent attempts on
 * the same task" test — WI6): every LINKED worktree of one repository
 * shares that repository's single `.git/config` file unless
 * `extensions.worktreeConfig` is separately enabled (out of scope here —
 * this package never asserts a per-worktree DIFFERENT identity, only the
 * one neutral identity every worktree carries identically, so there is no
 * correctness reason to adopt `--worktree` scope). Concurrent
 * `createWorktree` calls therefore race on the SAME config file's git-managed
 * lock (`config.lock`); git itself fails a write with "could not lock
 * config file" if it loses that race rather than blocking/retrying.
 * `runWithLockRetry` below retries on exactly that failure signature with a
 * small jittered backoff — safe here specifically because every concurrent
 * writer writes the IDENTICAL value, so who "wins" a given attempt is
 * irrelevant to correctness, only to whether the write eventually lands.
 */

import type { GitCommandError, GitPlumbing, GitSpawnResult } from "./plumbing.js";

/** The fixed neutral author/committer name every worktree this package creates carries — roadmap §In scope, "Git identity" bullet, literal. */
export const ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME = "Engineering Orchestrator";

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

const LOCK_ERROR_SIGNATURE = "could not lock config file";
const MAX_LOCK_RETRY_ATTEMPTS = 30;

function isConfigLockError(err: unknown): err is GitCommandError {
  return (
    err instanceof Error &&
    "stderrOutput" in err &&
    typeof (err as GitCommandError).stderrOutput === "string" &&
    (err as GitCommandError).stderrOutput.includes(LOCK_ERROR_SIGNATURE)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries `fn` on a git config-file lock contention failure (jittered backoff); re-throws immediately on any other error. */
async function runWithLockRetry(fn: () => Promise<GitSpawnResult>): Promise<GitSpawnResult> {
  for (let attempt = 0; attempt < MAX_LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isConfigLockError(err) || attempt === MAX_LOCK_RETRY_ATTEMPTS - 1) throw err;
      await sleep(5 + Math.random() * 15);
    }
  }
  // Unreachable (the loop above always returns or throws), but keeps this
  // function's return type total for the compiler.
  throw new Error("runWithLockRetry: exhausted retries without a definitive result");
}

/** Sets `user.name`/`user.email` locally in `worktreePath`'s own git config. `serviceEmail` is caller-supplied (this package's own scope stops at "configured service email" — resolving the actual configured address from project config is out of scope here, per roadmap §Out of scope). Safe to call concurrently across sibling worktrees of the same repository (see file-level doc comment). */
export async function configureGitIdentity(
  plumbing: GitPlumbing,
  worktreePath: string,
  serviceEmail: string,
): Promise<GitIdentity> {
  await runWithLockRetry(() =>
    plumbing.run(["config", "--local", "user.name", ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME], {
      cwd: worktreePath,
    }),
  );
  await runWithLockRetry(() =>
    plumbing.run(["config", "--local", "user.email", serviceEmail], { cwd: worktreePath }),
  );
  return { name: ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME, email: serviceEmail };
}

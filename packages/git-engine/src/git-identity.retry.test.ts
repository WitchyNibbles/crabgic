import { describe, expect, it } from "vitest";
import { configureGitIdentity } from "./git-identity.js";
import { GitCommandError, type GitPlumbing, type GitSpawnResult } from "./plumbing.js";

/**
 * Covers `git-identity.ts`'s lock-contention retry branch (found by WI6's
 * own "many concurrent attempts" test — see that file's doc comment) with
 * a fake `GitPlumbing` that deterministically fails-then-succeeds, rather
 * than relying on a real race to reproduce it.
 */

function fakePlumbing(runImpl: (args: readonly string[]) => Promise<GitSpawnResult>): GitPlumbing {
  return {
    gitBinary: "git",
    run: (args) => runImpl(args),
    version: async () => "git version 0.0.0 (fake)",
  };
}

describe("configureGitIdentity — lock-contention retry (WI6/WI8 concurrency fix)", () => {
  it("retries and succeeds after a transient 'could not lock config file' failure", async () => {
    let callCount = 0;
    const plumbing = fakePlumbing(async (args) => {
      callCount++;
      if (args[0] === "config" && callCount <= 2) {
        throw new GitCommandError(
          args,
          255,
          "error: could not lock config file .git/config: File exists\n",
        );
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const identity = await configureGitIdentity(plumbing, "/fake/worktree", "svc@example.invalid");
    expect(identity.email).toBe("svc@example.invalid");
    expect(callCount).toBeGreaterThan(2); // proves at least one retry happened
  });

  it("does NOT retry a non-lock error — it propagates immediately", async () => {
    let callCount = 0;
    const plumbing = fakePlumbing(async (args) => {
      callCount++;
      throw new GitCommandError(args, 128, "fatal: not a git repository\n");
    });

    await expect(
      configureGitIdentity(plumbing, "/fake/worktree", "svc@example.invalid"),
    ).rejects.toThrow("not a git repository");
    expect(callCount).toBe(1);
  });
});

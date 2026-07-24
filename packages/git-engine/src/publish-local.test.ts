import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeWorkingTreeHash } from "./invariance.js";
import {
  PublishedAttributionLeakError,
  PublishLocalInvarianceViolationError,
  publishLocal,
} from "./publish-local.js";
import {
  createGitPlumbing,
  createNodeGitSpawn,
  type GitPlumbing,
  type GitSpawnFn,
  type GitSpawnRequest,
} from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  commitAll,
  fixtureGit,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * roadmap/08-integration-publication.md work item 6 — Failing-first per the
 * roadmap's own text: "a publish test on a fixture repo must show no branch
 * and no evidence before the routine exists; after, the branch appears, the
 * user checkout is byte-identical, and there is zero remote interaction."
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

/** A capturing `GitSpawnFn` wrapping the real spawn — the "spawn-capture shim" this package already uses, here to prove ZERO remote interaction (no `push`, no network-shaped remote name) ever occurs. */
function createCapturingSpawn(): {
  readonly calls: GitSpawnRequest[];
  readonly spawnFn: GitSpawnFn;
} {
  const real = createNodeGitSpawn();
  const calls: GitSpawnRequest[] = [];
  return {
    calls,
    spawnFn: async (request) => {
      calls.push(request);
      return real(request);
    },
  };
}

/** Builds a "control repo" (standing in for 07's control clone) with a distinct commit on a named ref, and a separate "user repo" fixture that has never seen that commit. */
function buildPublishFixture(): {
  readonly userRepoPath: string;
  readonly controlRepoPath: string;
  readonly integrationObjectId: string;
} {
  const { dir: userRepoPath } = buildBasicFixtureRepo();
  dirs.push(userRepoPath);

  const { dir: controlRepoPath } = buildBasicFixtureRepo();
  dirs.push(controlRepoPath);
  fixtureGit(controlRepoPath, ["checkout", "-q", "-b", "integration/target"]);
  writeFixtureFile(controlRepoPath, "integrated.txt", "integrated content\n");
  const integrationObjectId = commitAll(controlRepoPath, "integration result");

  return { userRepoPath, controlRepoPath, integrationObjectId };
}

/** Same shape as `buildPublishFixture`, but the control repo's integration commit carries an attribution trailer in its message. */
function buildPublishFixtureWithAttributionLeak(): {
  readonly userRepoPath: string;
  readonly controlRepoPath: string;
} {
  const { dir: userRepoPath } = buildBasicFixtureRepo();
  dirs.push(userRepoPath);

  const { dir: controlRepoPath } = buildBasicFixtureRepo();
  dirs.push(controlRepoPath);
  fixtureGit(controlRepoPath, ["checkout", "-q", "-b", "integration/tainted"]);
  writeFixtureFile(controlRepoPath, "integrated.txt", "integrated content\n");
  fixtureGit(controlRepoPath, ["add", "-A"]);
  fixtureGit(controlRepoPath, [
    "commit",
    "-q",
    "-m",
    "integration result\n\n🤖 Generated with Claude Code\nCo-Authored-By: Claude <noreply@anthropic.com>",
    "--no-verify",
  ]);

  return { userRepoPath, controlRepoPath };
}

describe("publishLocal", () => {
  it("creates the destination branch in the user's repo, pointing at the integrated object id", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const { userRepoPath, controlRepoPath, integrationObjectId } = buildPublishFixture();

    const before = fixtureGit(userRepoPath, ["branch", "--list", "feat/my-change"]);
    expect(before.trim()).toBe("");

    const result = await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/my-change",
    });

    expect(result).toEqual({
      status: "published",
      branchName: "feat/my-change",
      objectId: integrationObjectId,
    });
    expect(fixtureGit(userRepoPath, ["rev-parse", "refs/heads/feat/my-change"]).trim()).toBe(
      integrationObjectId,
    );
  });

  it("never checks out, never touches HEAD/index/working tree — byte-identical user checkout before/after", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const { userRepoPath, controlRepoPath } = buildPublishFixture();

    const headBefore = fixtureGit(userRepoPath, ["rev-parse", "HEAD"]).trim();
    const workingTreeHashBefore = await computeWorkingTreeHash(userRepoPath);

    await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/publish-invariance",
    });

    const headAfter = fixtureGit(userRepoPath, ["rev-parse", "HEAD"]).trim();
    const workingTreeHashAfter = await computeWorkingTreeHash(userRepoPath);
    expect(headAfter).toBe(headBefore);
    expect(workingTreeHashAfter).toBe(workingTreeHashBefore);
  });

  it("zero remote interaction — no spawn call ever includes a push subcommand", async () => {
    const capturing = createCapturingSpawn();
    const plumbing = createGitPlumbing({ spawnFn: capturing.spawnFn });
    const { userRepoPath, controlRepoPath } = buildPublishFixture();

    await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/no-push",
    });

    for (const call of capturing.calls) {
      expect(call.args).not.toContain("push");
    }
    expect(capturing.calls.length).toBeGreaterThan(0); // sanity: the spawn shim actually observed real calls
  });

  it("reports blocked (never throws) when the source ref doesn't exist in the control repo", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const { userRepoPath, controlRepoPath } = buildPublishFixture();

    const result = await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "does-not-exist",
      branchName: "feat/missing-source",
    });

    expect(result.status).toBe("blocked");
  });

  it("reports blocked when the fetch itself reports success but the destination ref never resolves", async () => {
    const { userRepoPath, controlRepoPath } = buildPublishFixture();
    // A fake plumbing whose "fetch" call is a no-op reporting success —
    // simulating a transport that lies about having created the ref —
    // and whose "rev-parse" call always fails, exercising the "fetch
    // reported success but the destination ref is not resolvable" branch.
    const fakePlumbing: GitPlumbing = {
      gitBinary: "git",
      async run(args) {
        if (args[0] === "fetch") {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "not a valid ref", exitCode: 128 };
      },
      async version() {
        return "git version 2.43.0";
      },
    };

    const result = await publishLocal(fakePlumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/lying-transport",
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "fetch reported success but the destination ref is not resolvable",
    });
  });

  it("throws PublishLocalInvarianceViolationError when HEAD/index/working-tree change during the fetch", async () => {
    const { userRepoPath, controlRepoPath } = buildPublishFixture();
    // A fake plumbing whose "fetch" call mutates the user checkout's HEAD
    // file as a side effect (simulating a genuine invariance violation),
    // then reports success — the ONE failure mode this routine must never
    // silently accept.
    const fakePlumbing: GitPlumbing = {
      gitBinary: "git",
      async run(args) {
        if (args[0] === "fetch") {
          appendFileSync(join(userRepoPath, ".git", "HEAD"), "\n");
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "deadbeef", stderr: "", exitCode: 0 };
      },
      async version() {
        return "git version 2.43.0";
      },
    };

    await expect(
      publishLocal(fakePlumbing, {
        userRepoPath,
        controlRepoPath,
        sourceRef: "integration/target",
        branchName: "feat/mutates-head",
      }),
    ).rejects.toBeInstanceOf(PublishLocalInvarianceViolationError);
  });

  it("2026-07-24 MEDIUM fix — fails closed (throws, removes the branch) when a published commit carries attribution", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const { userRepoPath, controlRepoPath } = buildPublishFixtureWithAttributionLeak();

    await expect(
      publishLocal(plumbing, {
        userRepoPath,
        controlRepoPath,
        sourceRef: "integration/tainted",
        branchName: "feat/tainted",
      }),
    ).rejects.toBeInstanceOf(PublishedAttributionLeakError);

    // Fail-closed: the branch must not be left behind, tainted, for a
    // caller to stumble on.
    const listOutput = fixtureGit(userRepoPath, ["branch", "--list", "feat/tainted"]);
    expect(listOutput.trim()).toBe("");
  });

  it("2026-07-24 MEDIUM fix — never flags a PRE-EXISTING commit already in the user's history, only NEWLY introduced ones", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const { userRepoPath, controlRepoPath, integrationObjectId } = buildPublishFixture();

    // The user's OWN pre-existing history already contains an
    // attribution-shaped string (e.g. inherited from some unrelated prior
    // commit) — this must never block a publish that doesn't itself
    // introduce any new tainted commit.
    fixtureGit(userRepoPath, [
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "unrelated pre-existing commit mentioning Generated with SomeOtherTool",
    ]);

    const result = await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/preexisting-mention-is-fine",
    });

    expect(result).toEqual({
      status: "published",
      branchName: "feat/preexisting-mention-is-fine",
      objectId: integrationObjectId,
    });
  });

  it("2026-07-24 MEDIUM fix — gracefully treats a for-each-ref/rev-list read failure as 'nothing to scan' rather than throwing", async () => {
    const real = createNodeGitSpawn();
    const { userRepoPath, controlRepoPath, integrationObjectId } = buildPublishFixture();
    const fakeSpawn: GitSpawnFn = async (request) => {
      const subcommand = request.args[0];
      if (subcommand === "for-each-ref" || subcommand === "rev-list") {
        return { stdout: "", stderr: "simulated read failure", exitCode: 1 };
      }
      return real(request);
    };
    const plumbing = createGitPlumbing({ spawnFn: fakeSpawn });

    const result = await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/scan-read-failure-tolerant",
    });

    // The belt-and-suspenders scan itself failing to run (a rare
    // git-internal-error scenario, never a detected leak) fails OPEN, not
    // closed — distinct from `PublishedAttributionLeakError`, which fires
    // only on an ACTUAL detected leak.
    expect(result).toEqual({
      status: "published",
      branchName: "feat/scan-read-failure-tolerant",
      objectId: integrationObjectId,
    });
  });

  it("2026-07-24 MEDIUM fix — a single unreadable commit message (log failure) is skipped, not fatal, and scanning continues", async () => {
    const real = createNodeGitSpawn();
    const { userRepoPath, controlRepoPath, integrationObjectId } = buildPublishFixture();
    const fakeSpawn: GitSpawnFn = async (request) => {
      if (request.args[0] === "log") {
        return { stdout: "", stderr: "simulated log failure", exitCode: 1 };
      }
      return real(request);
    };
    const plumbing = createGitPlumbing({ spawnFn: fakeSpawn });

    const result = await publishLocal(plumbing, {
      userRepoPath,
      controlRepoPath,
      sourceRef: "integration/target",
      branchName: "feat/log-read-failure-tolerant",
    });

    expect(result).toEqual({
      status: "published",
      branchName: "feat/log-read-failure-tolerant",
      objectId: integrationObjectId,
    });
  });

  it("rejects a flag-shaped branchName before ever spawning git", async () => {
    const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
    const { userRepoPath, controlRepoPath } = buildPublishFixture();

    await expect(
      publishLocal(plumbing, {
        userRepoPath,
        controlRepoPath,
        sourceRef: "integration/target",
        branchName: "--upload-pack=touch /tmp/should-not-exist",
      }),
    ).rejects.toThrow();
  });
});

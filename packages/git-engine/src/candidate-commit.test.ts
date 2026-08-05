import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLLECTION_EXCLUDE_PATHSPECS,
  buildIntegrationCommit,
  buildIntegrationRef,
  commitWorktreeCandidate,
  neutralCommitIdentity,
} from "./candidate-commit.js";
import { InvalidObjectIdError } from "./git-arg-guard.js";
import { CRABGIC_GIT_IDENTITY_NAME } from "./git-identity.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import { createWorktree } from "./worktree-lifecycle.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * Real on-disk git throughout (roadmap/07 Test plan: "no mocked git"). These
 * are the two primitives phase 08 needed a producer for — a worker's
 * uncommitted output becoming a candidate commit, and a preflighted tree
 * becoming a commit on the integration tip.
 *
 * Every assertion reads structure back OUT of git (`rev-parse <oid>^{tree}`,
 * `^1`, `log --format`), never merely the exit status: a stub that returned a
 * plausible object id would satisfy an exit-code assertion and fail every one
 * of these.
 */

const SERVICE_EMAIL = "candidate@crabgic.invalid";
const IDENTITY = neutralCommitIdentity(SERVICE_EMAIL);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });

/** A control-clone stand-in plus one real attempt worktree of it. */
async function buildWorktreeFixture(): Promise<{
  readonly repoDir: string;
  readonly worktreePath: string;
  readonly ref: string;
  readonly baseObjectId: string;
}> {
  const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
  dirs.push(repoDir);
  const worktreesRootDir = freshTmpDir("eo-candidate-wt-");
  dirs.push(worktreesRootDir);
  const created = await createWorktree(plumbing, {
    repoDir,
    worktreesRootDir,
    runId: "run-1",
    changeSetId: "cs-1",
    taskId: "task-1",
    attempt: "attempt1",
    baseObjectId: headObjectId,
    serviceEmail: SERVICE_EMAIL,
  });
  return {
    repoDir,
    worktreePath: created.worktreePath,
    ref: created.ref,
    baseObjectId: headObjectId,
  };
}

describe("commitWorktreeCandidate — collecting a worker's uncommitted output", () => {
  it("commits the worker's edits onto the worktree's own branch and returns that tip", async () => {
    const fixture = await buildWorktreeFixture();
    writeFileSync(join(fixture.worktreePath, "src", "added.txt"), "worker output\n", "utf8");

    const result = await commitWorktreeCandidate(plumbing, {
      worktreePath: fixture.worktreePath,
      subject: "feat: add the worker output",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: pending",
      identity: IDENTITY,
      baseObjectId: fixture.baseObjectId,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;

    // The candidate IS the work branch's new tip, and it descends from base.
    expect(fixtureGit(fixture.repoDir, ["rev-parse", fixture.ref]).trim()).toBe(result.objectId);
    expect(fixtureGit(fixture.repoDir, ["rev-parse", `${result.objectId}^1`]).trim()).toBe(
      fixture.baseObjectId,
    );
    // The tree really holds the edit — a stub id cannot fake this.
    expect(
      fixtureGit(fixture.repoDir, ["ls-tree", "-r", "--name-only", result.objectId]).split("\n"),
    ).toContain("src/added.txt");
    // Message shape: rendered subject, blank line, rendered body.
    expect(fixtureGit(fixture.repoDir, ["log", "-1", "--format=%B", result.objectId])).toBe(
      "feat: add the worker output\n\nWhy: fixture\nRisk: none\nCompat: none\nVerification: pending\n\n",
    );
    // Neutral identity, from the environment overlay rather than a config write.
    expect(
      fixtureGit(fixture.repoDir, [
        "log",
        "-1",
        "--format=%an|%ae|%cn|%ce",
        result.objectId,
      ]).trim(),
    ).toBe(
      `${CRABGIC_GIT_IDENTITY_NAME}|${SERVICE_EMAIL}|${CRABGIC_GIT_IDENTITY_NAME}|${SERVICE_EMAIL}`,
    );
  });

  it("reports nothing-to-commit for an untouched worktree, leaving the branch at base", async () => {
    const fixture = await buildWorktreeFixture();

    const result = await commitWorktreeCandidate(plumbing, {
      worktreePath: fixture.worktreePath,
      subject: "feat: nothing happened",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: pending",
      identity: IDENTITY,
      baseObjectId: fixture.baseObjectId,
    });

    expect(result.status).toBe("nothing-to-commit");
    expect(fixtureGit(fixture.repoDir, ["rev-parse", fixture.ref]).trim()).toBe(
      fixture.baseObjectId,
    );
  });

  it("REVERSE PROBE — provisioned node_modules alone is dirty yet yields nothing-to-commit", async () => {
    const fixture = await buildWorktreeFixture();
    // Exactly what `provisionWorktreeDependencies` leaves behind in a project
    // that does not gitignore it. Without COLLECTION_EXCLUDE_PATHSPECS this
    // commits the whole provisioned tree; with them there is nothing to commit.
    mkdirSync(join(fixture.worktreePath, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(
      join(fixture.worktreePath, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
      "utf8",
    );

    // The worktree genuinely IS dirty — so this case is not passing because
    // the emptiness guard short-circuited on a clean tree.
    expect(fixtureGit(fixture.worktreePath, ["status", "--porcelain"]).trim()).not.toBe("");

    const result = await commitWorktreeCandidate(plumbing, {
      worktreePath: fixture.worktreePath,
      subject: "feat: only provisioning changed",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: pending",
      identity: IDENTITY,
      baseObjectId: fixture.baseObjectId,
    });

    expect(result.status).toBe("nothing-to-commit");
    expect(fixtureGit(fixture.repoDir, ["rev-parse", fixture.ref]).trim()).toBe(
      fixture.baseObjectId,
    );
    expect(COLLECTION_EXCLUDE_PATHSPECS.length).toBeGreaterThan(0);
  });

  it("HARDENING — work the worker committed ITSELF is returned as the candidate, never silently dropped", async () => {
    const fixture = await buildWorktreeFixture();
    // Today no worker can commit (the compiled profile grants no `git commit`),
    // so this state is unreachable through the shipped path. It is asserted
    // anyway because the alternative failure is silent and severe: a unit whose
    // work never reaches the integration ref, inside a run that reports SUCCESS
    // and publishes. The repository already carries a tracked residual where
    // enabling the OS sandbox auto-allows `Bash`, so "clean implies unchanged"
    // is an inference from a permission boundary rather than a fact.
    writeFileSync(join(fixture.worktreePath, "src", "self.txt"), "worker committed this\n", "utf8");
    fixtureGit(fixture.worktreePath, ["add", "--all"]);
    // Identity comes from the repo-local config `createWorktree` already wrote
    // (linked worktrees share `.git/config`) — no `git config` call here.
    fixtureGit(fixture.worktreePath, ["commit", "-q", "-m", "worker's own commit", "--no-verify"]);
    const selfCommitted = fixtureGit(fixture.worktreePath, ["rev-parse", "HEAD"]).trim();
    expect(selfCommitted).not.toBe(fixture.baseObjectId);
    // The worktree is now CLEAN — which is precisely the trap.
    expect(fixtureGit(fixture.worktreePath, ["status", "--porcelain"]).trim()).toBe("");

    const result = await commitWorktreeCandidate(plumbing, {
      worktreePath: fixture.worktreePath,
      subject: "feat: nothing left to stage",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: pending",
      identity: IDENTITY,
      baseObjectId: fixture.baseObjectId,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    expect(result.objectId).toBe(selfCommitted);
    // No second, empty commit was made on top of it.
    expect(fixtureGit(fixture.repoDir, ["rev-parse", fixture.ref]).trim()).toBe(selfCommitted);
    expect(
      fixtureGit(fixture.repoDir, ["ls-tree", "-r", "--name-only", result.objectId]).split("\n"),
    ).toContain("src/self.txt");
  });

  it("HARDENING — the same holds when the tip is ahead AND only excluded provisioning is dirty", async () => {
    const fixture = await buildWorktreeFixture();
    writeFileSync(join(fixture.worktreePath, "src", "self.txt"), "worker committed this\n", "utf8");
    fixtureGit(fixture.worktreePath, ["add", "--all"]);
    // Identity comes from the repo-local config `createWorktree` already wrote
    // (linked worktrees share `.git/config`) — no `git config` call here.
    fixtureGit(fixture.worktreePath, ["commit", "-q", "-m", "worker's own commit", "--no-verify"]);
    const selfCommitted = fixtureGit(fixture.worktreePath, ["rev-parse", "HEAD"]).trim();
    // Dirty (so the first guard does not fire) but nothing STAGEABLE (so the
    // second guard does) — the arm that would otherwise drop the work.
    mkdirSync(join(fixture.worktreePath, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(
      join(fixture.worktreePath, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
      "utf8",
    );
    expect(fixtureGit(fixture.worktreePath, ["status", "--porcelain"]).trim()).not.toBe("");

    const result = await commitWorktreeCandidate(plumbing, {
      worktreePath: fixture.worktreePath,
      subject: "feat: only provisioning is dirty",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: pending",
      identity: IDENTITY,
      baseObjectId: fixture.baseObjectId,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    expect(result.objectId).toBe(selfCommitted);
  });

  it("refuses a flag-shaped baseObjectId before git is ever invoked", async () => {
    const fixture = await buildWorktreeFixture();
    await expect(
      commitWorktreeCandidate(plumbing, {
        worktreePath: fixture.worktreePath,
        subject: "feat: nope",
        body: "Why: nope\nRisk: nope\nCompat: nope\nVerification: nope",
        identity: IDENTITY,
        baseObjectId: "--upload-pack=touch /tmp/pwned",
      }),
    ).rejects.toThrow(InvalidObjectIdError);
  });

  it("commits a real edit even when provisioned node_modules sits beside it, and excludes the provisioning", async () => {
    const fixture = await buildWorktreeFixture();
    writeFileSync(join(fixture.worktreePath, "src", "added.txt"), "worker output\n", "utf8");
    mkdirSync(join(fixture.worktreePath, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(
      join(fixture.worktreePath, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
      "utf8",
    );

    const result = await commitWorktreeCandidate(plumbing, {
      worktreePath: fixture.worktreePath,
      subject: "feat: add the worker output",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: pending",
      identity: IDENTITY,
      baseObjectId: fixture.baseObjectId,
    });

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    const paths = fixtureGit(fixture.repoDir, [
      "ls-tree",
      "-r",
      "--name-only",
      result.objectId,
    ]).split("\n");
    expect(paths).toContain("src/added.txt");
    expect(paths.some((path) => path.startsWith("node_modules/"))).toBe(false);
  });
});

describe("buildIntegrationCommit — wrapping a preflighted tree on the integration tip", () => {
  it("produces a single-parent commit carrying exactly the supplied tree", async () => {
    const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    // A second commit whose TREE is what we will wrap onto the first commit.
    writeFixtureFile(repoDir, "src/b.txt", "beta\n");
    fixtureGit(repoDir, ["add", "-A"]);
    fixtureGit(repoDir, ["commit", "-q", "-m", "second", "--no-verify"]);
    const treeId = fixtureGit(repoDir, ["rev-parse", "HEAD^{tree}"]).trim();

    const objectId = await buildIntegrationCommit(plumbing, {
      repoDir,
      treeId,
      parentObjectId: headObjectId,
      subject: "feat: integrate the beta unit",
      body: "Why: fixture\nRisk: none\nCompat: none\nVerification: preflighted",
      identity: IDENTITY,
    });

    expect(objectId).toMatch(/^[0-9a-f]{40}$/);
    expect(fixtureGit(repoDir, ["rev-parse", `${objectId}^{tree}`]).trim()).toBe(treeId);
    expect(fixtureGit(repoDir, ["rev-parse", `${objectId}^1`]).trim()).toBe(headObjectId);
    // Single parent — `^2` must not resolve.
    expect(() => fixtureGit(repoDir, ["rev-parse", "--verify", `${objectId}^2`])).toThrow();
    expect(fixtureGit(repoDir, ["log", "-1", "--format=%s", objectId]).trim()).toBe(
      "feat: integrate the beta unit",
    );
  });

  it("refuses a flag-shaped object id before git is ever invoked", async () => {
    const { dir: repoDir, headObjectId } = buildBasicFixtureRepo();
    dirs.push(repoDir);
    await expect(
      buildIntegrationCommit(plumbing, {
        repoDir,
        treeId: "--upload-pack=touch /tmp/pwned",
        parentObjectId: headObjectId,
        subject: "feat: nope",
        body: "Why: nope\nRisk: nope\nCompat: nope\nVerification: nope",
        identity: IDENTITY,
      }),
    ).rejects.toThrow(InvalidObjectIdError);
  });
});

describe("buildIntegrationRef", () => {
  it("scopes the integration tip to the run, outside refs/heads/", () => {
    expect(buildIntegrationRef("run-abc")).toBe("refs/crabgic/integration/run-abc");
    expect(buildIntegrationRef("run-abc").startsWith("refs/heads/")).toBe(false);
  });
});

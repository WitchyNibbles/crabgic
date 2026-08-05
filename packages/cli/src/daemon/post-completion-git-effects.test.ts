/**
 * The REAL git effects, against real on-disk repositories — the composition of
 * phase 08's preflight / CAS / publish routines the pipeline drives.
 *
 * Every case here is a branch the composed end-to-end walk cannot reach on
 * demand: a lint-blocked commit message, an integration ref left behind by an
 * interrupted pipeline, a LOST CAS race that has to rebuild against the ref's
 * real tip, a refused branch name, and a publish that git itself rejects. The
 * happy path is deliberately NOT re-tested here — `./composed-post-completion.e2e.test.ts`
 * owns it through production composition.
 *
 * No `git config` is ever run against a fixture: identity rides in the
 * environment (`@crabgic/testkit`'s `GIT_FIXTURE_IDENTITY_ENV`), and the
 * production code under test passes its own author/committer overlay.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChangeSet, WorkUnit } from "@crabgic/contracts";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  buildIntegrationRef,
  createGitPlumbing,
  createNodeGitSpawn,
  createWorktree,
  UnsafeGitRefError,
  type GitPlumbing,
} from "@crabgic/git-engine";
import {
  GIT_FIXTURE_IDENTITY_ENV,
  buildChangeSet,
  buildWorkUnit,
  runFixtureGit,
} from "@crabgic/testkit";
import {
  createRealPostCompletionGitEffects,
  type PostCompletionGitEffects,
} from "./post-completion-git-effects.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const UNIT_A = "33333333-3333-4333-8333-333333333333";
const SERVICE_EMAIL = "effects@crabgic.invalid";

const dirs: string[] = [];
let plumbing: GitPlumbing;
let journal: JournalStore;
let projectDir: string;
let controlDir: string;
let worktreesRootDir: string;
let baseObjectId: string;
let effects: PostCompletionGitEffects;

beforeEach(() => {
  plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
  const root = mkdtempSync(join(tmpdir(), "eo-effects-"));
  dirs.push(root);
  journal = createJournalStore({ journalDir: join(root, "journal") });
  projectDir = join(root, "project");
  controlDir = join(root, "control");
  worktreesRootDir = join(root, "worktrees");

  // A real user repo, and a real "control clone" of it.
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src", "shared.ts"), "export const shared = 1;\n", "utf8");
  runFixtureGit(projectDir, ["init", "-q", "-b", "main"]);
  runFixtureGit(projectDir, ["add", "--", "src"]);
  runFixtureGit(projectDir, ["commit", "-q", "-m", "initial", "--no-verify"], {
    env: GIT_FIXTURE_IDENTITY_ENV,
  });
  runFixtureGit(root, ["clone", "-q", "--no-local", projectDir, controlDir]);
  baseObjectId = runFixtureGit(controlDir, ["rev-parse", "HEAD"]).trim();

  effects = createRealPostCompletionGitEffects({
    plumbing,
    controlDir,
    projectDir,
    serviceEmail: SERVICE_EMAIL,
    journal,
  });
});

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function unit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return buildWorkUnit({
    id: UNIT_A,
    changeSetId: CHANGE_SET_ID,
    dependsOn: [],
    attemptStatus: "pending",
    requirementIds: [],
    title: "add the shared export",
    ownedPaths: ["src/"],
    ...overrides,
  });
}

function changeSet(): ChangeSet {
  return buildChangeSet({
    id: CHANGE_SET_ID,
    state: "ready",
    rollbackStrategy: "revert the integration commit",
  });
}

/** A real attempt worktree of the control clone, optionally with a worker edit already in it. */
async function attemptWorktree(options: { readonly edit?: string } = {}): Promise<string> {
  const created = await createWorktree(plumbing, {
    repoDir: controlDir,
    worktreesRootDir,
    runId: RUN_ID,
    changeSetId: CHANGE_SET_ID,
    taskId: `${UNIT_A}-${String(dirs.length)}-${String(Math.random()).slice(2, 8)}`,
    baseObjectId,
    serviceEmail: SERVICE_EMAIL,
  });
  if (options.edit !== undefined) {
    writeFileSync(join(created.worktreePath, "src", "shared.ts"), options.edit, "utf8");
  }
  return created.worktreePath;
}

describe("collectCandidate", () => {
  it("reports nothing-to-commit for a worktree the worker never touched", async () => {
    const result = await effects.collectCandidate({
      workUnit: unit(),
      changeSet: changeSet(),
      branchType: "chore",
      baseObjectId,
      worktreePath: await attemptWorktree(),
    });
    expect(result.status).toBe("nothing-to-commit");
  });

  it("BLOCKS when 17's lint refuses the rendered commit message, naming the artifact and the findings", async () => {
    // "co-authored-by" is one of `ATTRIBUTION_TOKENS`, and it survives into the
    // commit subject verbatim — so the render is refused rather than the message
    // being silently sanitized.
    const result = await effects.collectCandidate({
      workUnit: unit({ title: "co-authored-by somebody else" }),
      changeSet: changeSet(),
      branchType: "chore",
      baseObjectId,
      worktreePath: await attemptWorktree({ edit: "export const shared = 2;\n" }),
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.reason).toContain("policy_blocked");
    expect(result.reason).toContain("subject");
    // Attributable to the LINT, not to a git failure.
    expect(result.reason).toMatch(/refused the rendered commit/i);
  });
});

describe("beginIntegration", () => {
  it("creates the run-scoped integration ref at the frozen base, outside refs/heads/", async () => {
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    expect(begun.status).toBe("begun");
    if (begun.status !== "begun") return;
    expect(begun.ref).toBe(buildIntegrationRef(RUN_ID));
    expect(runFixtureGit(controlDir, ["rev-parse", "--verify", begun.ref]).trim()).toBe(
      baseObjectId,
    );
    // A `cas_ref_update` is journaled for the creation, so the ref's provenance
    // is on the record rather than appearing from nowhere.
    const refs: string[] = [];
    for await (const entry of journal.queryEntries({ type: "cas_ref_update" })) {
      if (entry.type !== "cas_ref_update") continue;
      refs.push(entry.payload.ref);
    }
    expect(refs).toContain(begun.ref);
  });

  it("REFUSES when the ref already exists — an interrupted pipeline is never silently resumed", async () => {
    const ref = buildIntegrationRef(RUN_ID);
    // Exactly what a crash mid-pipeline leaves behind.
    runFixtureGit(controlDir, ["update-ref", ref, baseObjectId]);

    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    expect(begun.status).toBe("blocked");
    if (begun.status !== "blocked") return;
    expect(begun.reason).toContain(ref);
    expect(begun.reason).toMatch(/already exists/i);
    expect(begun.reason).toContain("Cancel the run");
  });
});

describe("integrateCandidate", () => {
  async function candidateFor(content: string): Promise<string> {
    const collected = await effects.collectCandidate({
      workUnit: unit(),
      changeSet: changeSet(),
      branchType: "chore",
      baseObjectId,
      worktreePath: await attemptWorktree({ edit: content }),
    });
    if (collected.status !== "collected")
      throw new Error(`expected a candidate: ${collected.status}`);
    return collected.objectId;
  }

  it("REBUILDS against the ref's real tip after losing the CAS race, and converges", async () => {
    const ref = buildIntegrationRef(RUN_ID);
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");

    // Somebody else advances the ref between the preflight and the CAS: build a
    // real commit on top of base, on a DISJOINT path so the rebuild's
    // re-preflight succeeds.
    const otherWorktree = await attemptWorktree();
    writeFileSync(join(otherWorktree, "src", "other.ts"), "export const other = 1;\n", "utf8");
    runFixtureGit(otherWorktree, ["add", "--all"]);
    runFixtureGit(otherWorktree, ["commit", "-q", "-m", "other work", "--no-verify"], {
      env: GIT_FIXTURE_IDENTITY_ENV,
    });
    const winner = runFixtureGit(otherWorktree, ["rev-parse", "HEAD"]).trim();
    runFixtureGit(controlDir, ["update-ref", ref, winner, baseObjectId]);

    // Our caller still believes the tip is `baseObjectId` — the stale
    // `expectedOldValue` that loses the race.
    const integrated = await effects.integrateCandidate({
      ref,
      tipObjectId: baseObjectId,
      candidateObjectId: await candidateFor("export const shared = 2;\n"),
      workUnit: unit(),
      changeSet: changeSet(),
      branchType: "chore",
      runId: RUN_ID,
    });

    expect(integrated.status).toBe("integrated");
    if (integrated.status !== "integrated") return;
    // It landed ON TOP of the winner, not over it — the whole point of CAS.
    expect(runFixtureGit(controlDir, ["rev-parse", ref]).trim()).toBe(integrated.tipObjectId);
    expect(runFixtureGit(controlDir, ["rev-parse", `${integrated.tipObjectId}^1`]).trim()).toBe(
      winner,
    );
    // And the rebuilt tree carries BOTH the winner's file and ours.
    const paths = runFixtureGit(controlDir, [
      "ls-tree",
      "-r",
      "--name-only",
      integrated.tipObjectId,
    ]).split("\n");
    expect(paths).toContain("src/other.ts");
    expect(runFixtureGit(controlDir, ["show", `${integrated.tipObjectId}:src/shared.ts`])).toBe(
      "export const shared = 2;\n",
    );
  });

  it("BLOCKS when the lint refuses the INTEGRATION commit message, distinctly from refusing the collection", async () => {
    const ref = buildIntegrationRef(RUN_ID);
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");
    // The candidate is collected under a CLEAN title, so the collection
    // succeeded; the integration commit is then rendered from a hostile one.
    // That separation is the point: the two commits go through `renderCommit`
    // independently, and only the integration commit reaches the published
    // branch, so its refusal is the one that must not be skippable.
    const candidateObjectId = await candidateFor("export const shared = 2;\n");

    const integrated = await effects.integrateCandidate({
      ref,
      tipObjectId: baseObjectId,
      candidateObjectId,
      workUnit: unit({ title: "co-authored-by somebody else" }),
      changeSet: changeSet(),
      branchType: "chore",
      runId: RUN_ID,
    });

    expect(integrated.status).toBe("blocked");
    if (integrated.status !== "blocked") return;
    expect(integrated.reason).toContain("policy_blocked");
    // The ref did NOT advance: nothing was landed under a refused message.
    expect(runFixtureGit(controlDir, ["rev-parse", ref]).trim()).toBe(baseObjectId);
  });

  it("surfaces a conflict discovered DURING the rebuild as a conflict, not an opaque block", async () => {
    const ref = buildIntegrationRef(RUN_ID);
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");

    // The race winner edits the SAME line our candidate does, so the rebuild's
    // re-preflight conflicts.
    const otherWorktree = await attemptWorktree({ edit: "export const shared = 99;\n" });
    runFixtureGit(otherWorktree, ["add", "--all"]);
    runFixtureGit(otherWorktree, ["commit", "-q", "-m", "conflicting work", "--no-verify"], {
      env: GIT_FIXTURE_IDENTITY_ENV,
    });
    const winner = runFixtureGit(otherWorktree, ["rev-parse", "HEAD"]).trim();
    runFixtureGit(controlDir, ["update-ref", ref, winner, baseObjectId]);

    const integrated = await effects.integrateCandidate({
      ref,
      tipObjectId: baseObjectId,
      candidateObjectId: await candidateFor("export const shared = 2;\n"),
      workUnit: unit(),
      changeSet: changeSet(),
      branchType: "chore",
      runId: RUN_ID,
    });

    expect(integrated.status).toBe("conflict");
    if (integrated.status !== "conflict") return;
    expect(integrated.resolutionUnits.map((resolution) => resolution.ownedPaths)).toEqual([
      ["src/shared.ts"],
    ]);
    // The ref is untouched: CAS never overwrote the winner.
    expect(runFixtureGit(controlDir, ["rev-parse", ref]).trim()).toBe(winner);
  });
});

describe("publishCandidate", () => {
  it("REFUSES a branch name the communication policy blocks, and creates nothing", async () => {
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");

    const published = await effects.publishCandidate({
      ref: begun.ref,
      branchType: "chore",
      // Slugifies to something perfectly ref-legal — legality alone is not enough.
      slugSource: "co-authored-by claude",
    });

    expect(published.status).toBe("blocked");
    if (published.status !== "blocked") return;
    expect(published.reason).toContain("policy_blocked");
    // Only the fixture's own branch exists in the user repo.
    expect(
      runFixtureGit(projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ).toEqual(["main"]);
  });

  it("BLOCKS when git itself refuses the fetch, rather than reporting a publication", async () => {
    // A ref that does not exist in the control clone: `publishLocal`'s fetch
    // fails and the reason is git's own.
    const published = await effects.publishCandidate({
      ref: "refs/crabgic/integration/never-created",
      branchType: "chore",
      slugSource: "add the shared export",
    });

    expect(published.status).toBe("blocked");
    if (published.status !== "blocked") return;
    expect(published.reason.length).toBeGreaterThan(0);
    expect(
      runFixtureGit(projectDir, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/",
      ]).trim(),
    ).toBe("main");
  });

  it("tolerates an unreadable user checkout when listing existing branches, and still refuses to claim a publication", async () => {
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");
    // A `projectDir` that is not a repository at all: the existing-branch census
    // must degrade to "assume none" rather than throwing, and the publish must
    // then BLOCK rather than report success against a repo it never wrote to.
    const notARepo = join(dirs[0]!, "not-a-repo");
    mkdirSync(notARepo, { recursive: true });
    const detached = createRealPostCompletionGitEffects({
      plumbing,
      controlDir,
      projectDir: notARepo,
      serviceEmail: SERVICE_EMAIL,
      journal,
    });

    const published = await detached.publishCandidate({
      ref: begun.ref,
      branchType: "chore",
      slugSource: "add the shared export",
    });

    expect(published.status).toBe("blocked");
    if (published.status !== "blocked") return;
    expect(published.reason.length).toBeGreaterThan(0);
  });

  it("applies a collision suffix rather than colliding with a branch the user repo already has", async () => {
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");
    // The unsuffixed name is already taken in the user's repo.
    runFixtureGit(projectDir, ["branch", "chore/add-the-shared-export", "main"]);

    const published = await effects.publishCandidate({
      ref: begun.ref,
      branchType: "chore",
      slugSource: "add the shared export",
    });

    expect(published.status).toBe("published");
    if (published.status !== "published") return;
    expect(published.branchName).not.toBe("chore/add-the-shared-export");
    expect(published.branchName).toMatch(/^chore\/add-the-shared-export-\d+$/);
    expect(runFixtureGit(projectDir, ["rev-parse", published.branchName]).trim()).toBe(
      published.objectId,
    );
  });
});

describe("retractPublishedBranch", () => {
  it("removes a branch this pipeline published, leaving the user checkout otherwise untouched", async () => {
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");
    const published = await effects.publishCandidate({
      ref: begun.ref,
      branchType: "chore",
      slugSource: "add the shared export",
    });
    if (published.status !== "published") throw new Error("publication did not happen");
    expect(runFixtureGit(projectDir, ["rev-parse", "--verify", published.branchName]).trim()).toBe(
      published.objectId,
    );
    const headBefore = runFixtureGit(projectDir, ["rev-parse", "HEAD"]).trim();

    await effects.retractPublishedBranch({ branchName: published.branchName });

    // Gone, read back out of real git.
    expect(() =>
      runFixtureGit(projectDir, ["rev-parse", "--verify", `refs/heads/${published.branchName}`]),
    ).toThrow();
    expect(
      runFixtureGit(projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ).toEqual(["main"]);
    // Only refs/ moved — HEAD is where it was.
    expect(runFixtureGit(projectDir, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
  });

  it("is a no-op rather than a throw when the branch is already gone — a retraction must not mask the refusal that provoked it", async () => {
    await expect(
      effects.retractPublishedBranch({ branchName: "chore/never-existed" }),
    ).resolves.toBeUndefined();
  });

  it("refuses a flag-shaped branch name before git is ever invoked", async () => {
    await expect(
      effects.retractPublishedBranch({ branchName: "--upload-pack=touch /tmp/pwned" }),
    ).rejects.toThrow(UnsafeGitRefError);
  });
});

describe("resolveIntegratedObjectId", () => {
  it("reads the tip out of the control clone's own ref store", async () => {
    const begun = await effects.beginIntegration({
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      baseObjectId,
    });
    if (begun.status !== "begun") throw new Error("integration did not begin");
    expect(await effects.resolveIntegratedObjectId({ ref: begun.ref })).toBe(baseObjectId);
  });
});

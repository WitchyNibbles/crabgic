import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UnsafeGitRefError, InvalidObjectIdError } from "./git-arg-guard.js";
import { computeWorkingTreeHash } from "./invariance.js";
import { preflightMerge } from "./merge-preflight.js";
import { GitCommandError, createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  commitAll,
  fixtureGit,
  freshTmpDir,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * roadmap/08-integration-publication.md work item 1 — Failing-first per the
 * roadmap's own text: "a fixture with an intersecting hunk must yield a
 * `WorkUnit`, not a silent auto-merge; a clean fixture must yield a
 * `treeId` with no `WorkUnit`s."
 *
 * 2026-07-24 adversarial-validation fix (HIGH + MEDIUM findings): the
 * `frozenBaseObjectId` parameter was renamed to `integrationTipObjectId`
 * (see `./merge-preflight.ts`'s file-level doc comment) — every fixture
 * builder/test below uses the new name, and this file adds the two-work-unit
 * end-to-end proof plus the control-context-isolation regression test.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

/** Builds a repo with a base commit, a "current tip" commit that diverges cleanly, and a "candidate" branch that diverges on a DIFFERENT file (no overlap). */
function buildCleanDivergingFixture(): {
  readonly dir: string;
  readonly integrationTipObjectId: string;
  readonly candidateRef: string;
} {
  const { dir } = buildBasicFixtureRepo();
  dirs.push(dir);
  fixtureGit(dir, ["checkout", "-q", "-b", "candidate"]);
  writeFixtureFile(dir, "candidate-only.txt", "candidate change\n");
  commitAll(dir, "candidate change");
  fixtureGit(dir, ["checkout", "-q", "main"]);
  writeFixtureFile(dir, "src/a.txt", "alpha\nmain-side change\n");
  const integrationTipObjectId = commitAll(dir, "main-side change");
  return { dir, integrationTipObjectId, candidateRef: "candidate" };
}

/** Builds a repo where both the current tip and the candidate branch edit the SAME line of the SAME file — a genuine, unresolvable-by-git conflict. */
function buildConflictingFixture(): {
  readonly dir: string;
  readonly integrationTipObjectId: string;
  readonly candidateRef: string;
} {
  const { dir } = buildBasicFixtureRepo();
  dirs.push(dir);
  fixtureGit(dir, ["checkout", "-q", "-b", "candidate"]);
  writeFixtureFile(dir, "src/a.txt", "alpha\ncandidate-change\n");
  commitAll(dir, "candidate edits a.txt");
  fixtureGit(dir, ["checkout", "-q", "main"]);
  writeFixtureFile(dir, "src/a.txt", "alpha\nmain-change\n");
  const integrationTipObjectId = commitAll(dir, "main edits a.txt too");
  return { dir, integrationTipObjectId, candidateRef: "candidate" };
}

describe("preflightMerge", () => {
  it("a clean, non-overlapping candidate yields a treeId and no conflicts", async () => {
    const { dir, integrationTipObjectId, candidateRef } = buildCleanDivergingFixture();
    const beforeHash = await computeWorkingTreeHash(dir);

    const result = await preflightMerge(plumbing, {
      repoDir: dir,
      candidateRef,
      integrationTipObjectId,
      changeSetId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.treeId).toMatch(/^[0-9a-f]{40,64}$/);
    }
    const afterHash = await computeWorkingTreeHash(dir);
    expect(afterHash).toBe(beforeHash); // invariance-harness extension: no working-tree mutation
  });

  it("an intersecting hunk yields resolution WorkUnits, never a silent auto-merge", async () => {
    const { dir, integrationTipObjectId, candidateRef } = buildConflictingFixture();

    const result = await preflightMerge(plumbing, {
      repoDir: dir,
      candidateRef,
      integrationTipObjectId,
      changeSetId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts).toHaveLength(1);
      const unit = result.conflicts[0]!;
      expect(unit.ownedPaths).toEqual(["src/a.txt"]);
      expect(unit.changeSetId).toBe("22222222-2222-4222-8222-222222222222");
      expect(unit.attemptStatus).toBe("pending");
      expect(unit.role).toBe("merge-conflict-resolution");
      expect(unit.title).toContain("src/a.txt");
    }
  });

  it("honors a caller-supplied conflictRole", async () => {
    const { dir, integrationTipObjectId, candidateRef } = buildConflictingFixture();

    const result = await preflightMerge(plumbing, {
      repoDir: dir,
      candidateRef,
      integrationTipObjectId,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      conflictRole: "custom-resolution-role",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts[0]!.role).toBe("custom-resolution-role");
    }
  });

  it("rejects a flag-shaped candidateRef before ever spawning git", async () => {
    const { dir, integrationTipObjectId } = buildCleanDivergingFixture();
    await expect(
      preflightMerge(plumbing, {
        repoDir: dir,
        candidateRef: "--upload-pack=touch /tmp/should-not-exist",
        integrationTipObjectId,
        changeSetId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toBeInstanceOf(UnsafeGitRefError);
  });

  it("rejects a non-hex integrationTipObjectId before ever spawning git", async () => {
    const { dir } = buildCleanDivergingFixture();
    await expect(
      preflightMerge(plumbing, {
        repoDir: dir,
        candidateRef: "candidate",
        integrationTipObjectId: "-Bmain",
        changeSetId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toBeInstanceOf(InvalidObjectIdError);
  });

  it("raises GitCommandError for a genuine git failure (unknown ref) rather than misreporting it as a conflict", async () => {
    const { dir, integrationTipObjectId } = buildCleanDivergingFixture();
    await expect(
      preflightMerge(plumbing, {
        repoDir: dir,
        candidateRef: "does-not-exist-anywhere",
        integrationTipObjectId,
        changeSetId: "66666666-6666-4666-8666-666666666666",
      }),
    ).rejects.toBeInstanceOf(GitCommandError);
  });
});

describe("2026-07-24 HIGH-finding fix — non-vacuous cross-work-unit conflict detection", () => {
  it("WU-B's candidate conflicts against the tip AFTER WU-A's candidate has already integrated", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const frozenBase = fixtureGit(dir, ["rev-parse", "main"]).trim();

    fixtureGit(dir, ["checkout", "-q", "-b", "wu-a"]);
    writeFixtureFile(dir, "src/a.txt", "alpha\nwu-a-change\n");
    const wuACandidateHead = commitAll(dir, "wu-a edits a.txt");

    fixtureGit(dir, ["checkout", "-q", "main"]);
    fixtureGit(dir, ["checkout", "-q", "-b", "wu-b"]);
    writeFixtureFile(dir, "src/a.txt", "alpha\nwu-b-change\n");
    commitAll(dir, "wu-b edits a.txt");

    fixtureGit(dir, ["checkout", "-q", "main"]);

    // WU-A preflighted against the frozen base — nothing integrated yet, so
    // this correctly resolves clean (the ordinary, common first-work-unit
    // case; the tip legitimately equals the frozen base here).
    const preflightA = await preflightMerge(plumbing, {
      repoDir: dir,
      candidateRef: "wu-a",
      integrationTipObjectId: frozenBase,
      changeSetId: "88888888-8888-4888-8888-888888888881",
    });
    expect(preflightA.ok).toBe(true);
    if (!preflightA.ok) return;

    // "Integrate" WU-A for real: a genuine 2-parent commit built from the
    // returned treeId — mirrors what a real `applyCasUpdate`-driven landing
    // does, advancing the integration tip past the frozen base.
    const advancedTip = fixtureGit(dir, [
      "commit-tree",
      preflightA.treeId,
      "-p",
      frozenBase,
      "-p",
      wuACandidateHead,
      "-m",
      "integrate wu-a",
    ]).trim();

    // WU-B's candidate — built from the SAME frozen base, never having seen
    // WU-A's change — is now preflighted against the ADVANCED tip. This is
    // the non-vacuous proof: passing the (never-advancing) frozen base here
    // instead would always resolve clean regardless of what WU-A did (see
    // the companion "demonstrates the vacuity" test below); passing the
    // real current tip correctly surfaces the conflict.
    const preflightB = await preflightMerge(plumbing, {
      repoDir: dir,
      candidateRef: "wu-b",
      integrationTipObjectId: advancedTip,
      changeSetId: "88888888-8888-4888-8888-888888888882",
    });

    expect(preflightB.ok).toBe(false);
    if (!preflightB.ok) {
      expect(preflightB.conflicts).toHaveLength(1);
      expect(preflightB.conflicts[0]!.ownedPaths).toEqual(["src/a.txt"]);
    }
  });

  it("demonstrates the vacuity this fix closes: preflighting WU-B against the STALE frozen base (not the advanced tip) misses the same real conflict", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    const frozenBase = fixtureGit(dir, ["rev-parse", "main"]).trim();

    fixtureGit(dir, ["checkout", "-q", "-b", "wu-a"]);
    writeFixtureFile(dir, "src/a.txt", "alpha\nwu-a-change\n");
    commitAll(dir, "wu-a edits a.txt");

    fixtureGit(dir, ["checkout", "-q", "main"]);
    fixtureGit(dir, ["checkout", "-q", "-b", "wu-b"]);
    writeFixtureFile(dir, "src/a.txt", "alpha\nwu-b-change\n");
    commitAll(dir, "wu-b edits a.txt");

    // WU-B preflighted against the STILL-frozen base (WU-A's integration is
    // never reflected) resolves clean even though WU-A and WU-B genuinely
    // conflict on the same line — merge-tree's own computed merge-base is
    // exactly the frozen base (an ancestor of wu-b), making this a trivial
    // fast-forward. This is exactly the bug the parameter rename +
    // documented ownership contract in `./merge-preflight.ts` closes:
    // callers MUST supply the advancing tip, never the frozen base.
    const result = await preflightMerge(plumbing, {
      repoDir: dir,
      candidateRef: "wu-b",
      integrationTipObjectId: frozenBase,
      changeSetId: "99999999-9999-4999-8999-999999999999",
    });
    expect(result.ok).toBe(true);
  });
});

describe("2026-07-24 MEDIUM-finding fix — control-context isolation for merge-tree", () => {
  it("an ambient global merge-driver declaration never fires during preflightMerge", async () => {
    const sandbox = freshTmpDir();
    dirs.push(sandbox);
    const markerPath = join(sandbox, "driver-fired.marker");
    const globalConfigPath = join(sandbox, "ambient-gitconfig");
    writeFileSync(
      globalConfigPath,
      [
        '[merge "eo-test-merge-driver"]',
        "\tname = EO test driver",
        `\tdriver = touch ${markerPath}`,
        "",
      ].join("\n"),
      "utf8",
    );

    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    writeFixtureFile(dir, ".gitattributes", "driven.txt merge=eo-test-merge-driver\n");
    writeFixtureFile(dir, "driven.txt", "line1\n");
    commitAll(dir, "add attribute + base file");

    fixtureGit(dir, ["checkout", "-q", "-b", "candidate"]);
    writeFixtureFile(dir, "driven.txt", "line1\ncandidate-change\n");
    commitAll(dir, "candidate edits driven.txt");

    fixtureGit(dir, ["checkout", "-q", "main"]);
    writeFixtureFile(dir, "driven.txt", "line1\nmain-change\n");
    const tip = commitAll(dir, "main edits driven.txt too");

    const originalAmbientGlobal = process.env["GIT_CONFIG_GLOBAL"];
    process.env["GIT_CONFIG_GLOBAL"] = globalConfigPath;
    try {
      expect(existsSync(markerPath)).toBe(false);

      await preflightMerge(plumbing, {
        repoDir: dir,
        candidateRef: "candidate",
        integrationTipObjectId: tip,
        changeSetId: "77777777-7777-4777-8777-777777777777",
      });

      expect(existsSync(markerPath)).toBe(false);
    } finally {
      if (originalAmbientGlobal === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
      else process.env["GIT_CONFIG_GLOBAL"] = originalAmbientGlobal;
    }
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { analyzeOverlap, detectRenamesFromWorktree } from "./overlap-analyzer.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * WI7 — roadmap/07-git-control-repo-worktrees.md work item 7:
 * "Failing-test-first: a moved-in-one/edited-in-other fixture must be
 * flagged as a collision before the analyzer has real logic." Property
 * test lives in `./overlap-analyzer.property.test.ts`.
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

describe("analyzeOverlap — pure pairwise collision detection (WI7)", () => {
  it("flags a moved-in-one/edited-in-other collision (rename-aware)", () => {
    const sets = [
      {
        unitId: "unit-a",
        paths: ["src/new-name.txt"],
        renames: [{ from: "src/old-name.txt", to: "src/new-name.txt" }],
      },
      { unitId: "unit-b", paths: ["src/old-name.txt"] },
    ];
    const verdicts = analyzeOverlap(sets);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.collides).toBe(true);
    expect(verdicts[0]!.collidingPaths).toContain("src/old-name.txt");
  });

  it("never flags a disjoint pair", () => {
    const sets = [
      { unitId: "unit-a", paths: ["src/a.txt"] },
      { unitId: "unit-b", paths: ["src/b.txt"] },
    ];
    const verdicts = analyzeOverlap(sets);
    expect(verdicts[0]!.collides).toBe(false);
    expect(verdicts[0]!.collidingPaths).toEqual([]);
  });

  it("flags a plain literal-path collision (no rename involved)", () => {
    const sets = [
      { unitId: "unit-a", paths: ["src/shared.txt"] },
      { unitId: "unit-b", paths: ["src/shared.txt"] },
    ];
    const verdicts = analyzeOverlap(sets);
    expect(verdicts[0]!.collides).toBe(true);
    expect(verdicts[0]!.collidingPaths).toEqual(["src/shared.txt"]);
  });

  it("produces one verdict per pair across 3+ units", () => {
    const sets = [
      { unitId: "a", paths: ["x"] },
      { unitId: "b", paths: ["y"] },
      { unitId: "c", paths: ["z"] },
    ];
    const verdicts = analyzeOverlap(sets);
    expect(verdicts).toHaveLength(3); // (a,b) (a,c) (b,c)
  });

  it("flags a declared non-Git resource collision and labels it separately", () => {
    const sets = [
      { unitId: "unit-a", paths: ["package-lock.json"] },
      { unitId: "unit-b", paths: ["package-lock.json"] },
    ];
    const verdicts = analyzeOverlap(sets, [{ path: "package-lock.json", label: "npm lockfile" }]);
    expect(verdicts[0]!.collides).toBe(true);
    expect(verdicts[0]!.declaredResourceCollisions).toEqual(["package-lock.json"]);
  });
});

/**
 * MAJOR 3 (2026-07-18 adversarial validation round) — OVERLAP ANALYZER
 * FALSE-NEGATIVES. Path comparison was exact-string equality with zero
 * normalization, so spelling-equivalent same-file pairs were cleared as
 * `collides:false` — a missed collision that would let 13 run genuinely
 * colliding units concurrently. Each `it` below is one of the validator's
 * exact proven-false-negative pairs.
 */
describe("analyzeOverlap — F3 path normalization (validator's exact false-negative pairs, MAJOR 3 fix)", () => {
  it("src/a.txt vs ./src/a.txt collide (leading './' spelling)", () => {
    const verdicts = analyzeOverlap([
      { unitId: "unit-a", paths: ["src/a.txt"] },
      { unitId: "unit-b", paths: ["./src/a.txt"] },
    ]);
    expect(verdicts[0]!.collides).toBe(true);
  });

  it("pkg/ vs pkg collide (trailing slash spelling)", () => {
    const verdicts = analyzeOverlap([
      { unitId: "unit-a", paths: ["pkg/"] },
      { unitId: "unit-b", paths: ["pkg"] },
    ]);
    expect(verdicts[0]!.collides).toBe(true);
  });

  it("a//b vs a/b collide (doubled-slash spelling)", () => {
    const verdicts = analyzeOverlap([
      { unitId: "unit-a", paths: ["a//b"] },
      { unitId: "unit-b", paths: ["a/b"] },
    ]);
    expect(verdicts[0]!.collides).toBe(true);
  });

  it("unit-a's ./package-lock.json collides with unit-b's plain package-lock.json, and is recognized against a differently-spelled registry entry", () => {
    const verdicts = analyzeOverlap(
      [
        { unitId: "unit-a", paths: ["./package-lock.json"] },
        { unitId: "unit-b", paths: ["package-lock.json"] },
      ],
      [{ path: "./package-lock.json", label: "npm lockfile" }],
    );
    expect(verdicts[0]!.collides).toBe(true);
    expect(verdicts[0]!.declaredResourceCollisions).toEqual(["package-lock.json"]);
  });

  it("does NOT case-fold (documented scoping decision — case differences never collide)", () => {
    const verdicts = analyzeOverlap([
      { unitId: "unit-a", paths: ["Src/A.txt"] },
      { unitId: "unit-b", paths: ["src/a.txt"] },
    ]);
    expect(verdicts[0]!.collides).toBe(false);
  });
});

describe("detectRenamesFromWorktree — real `git diff --find-renames` (WI7 integration, no mocked git)", () => {
  it("detects a real rename between two commits via --find-renames", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    fixtureGit(dir, ["checkout", "-q", "main"]);
    const baseRef = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();

    fixtureGit(dir, ["mv", "src/a.txt", "src/a-renamed.txt"]);
    fixtureGit(dir, ["commit", "-q", "-m", "rename a.txt", "--no-verify"]);
    const headRef = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();

    const detected = await detectRenamesFromWorktree(plumbing, dir, baseRef, headRef);
    expect(detected.renames).toHaveLength(1);
    expect(detected.renames[0]).toMatchObject({ from: "src/a.txt", to: "src/a-renamed.txt" });
  });

  it("real-git end-to-end: a fixture repo's move-in-one/edit-in-other is flagged as a collision", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    fixtureGit(dir, ["checkout", "-q", "main"]);
    const baseRef = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();

    // Unit A: rename src/a.txt -> src/a-renamed.txt, in its own branch.
    fixtureGit(dir, ["checkout", "-q", "-b", "unit-a-branch"]);
    fixtureGit(dir, ["mv", "src/a.txt", "src/a-renamed.txt"]);
    fixtureGit(dir, ["commit", "-q", "-m", "unit A: rename", "--no-verify"]);
    const unitAHead = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();

    // Unit B: edit src/a.txt in place, on a separate branch from base.
    fixtureGit(dir, ["checkout", "-q", "-b", "unit-b-branch", baseRef]);
    writeFixtureFile(dir, "src/a.txt", "edited by unit B\n");
    fixtureGit(dir, ["commit", "-q", "-am", "unit B: edit", "--no-verify"]);
    const unitBHead = fixtureGit(dir, ["rev-parse", "HEAD"]).trim();

    const unitAChanges = await detectRenamesFromWorktree(plumbing, dir, baseRef, unitAHead);
    const unitBChanges = await detectRenamesFromWorktree(plumbing, dir, baseRef, unitBHead);

    const verdicts = analyzeOverlap([
      { unitId: "unit-a", paths: unitAChanges.paths, renames: unitAChanges.renames },
      { unitId: "unit-b", paths: unitBChanges.paths, renames: unitBChanges.renames },
    ]);

    expect(verdicts[0]!.collides).toBe(true);
    expect(verdicts[0]!.collidingPaths).toContain("src/a.txt");
  });
});

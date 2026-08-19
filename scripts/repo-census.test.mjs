/**
 * Unit tests for the repo census — specifically the DISAGREEMENT engine, which
 * is the part that carries the claim.
 *
 * WHY THIS EXISTS. A research record in this repository spent ten review rounds
 * designing an mtime staleness check while `scripts/bundle-types.mjs:70` already
 * implemented one, and answered "nothing already detects it". The search space
 * had been narrowed to `packages/cli/src/doctor/checks/` and `check:all` by
 * plausible convention, and nothing ever compared that space to the claim.
 * `scripts/` appears in zero `tsconfig.json` files, so every build-graph-derived
 * enumeration excluded it too — measured: `scip-typescript` indexes 1501
 * documents here and ZERO `.mjs` files.
 *
 * The census does not try to be a better index. It cross-checks several
 * INDEPENDENT enumerations of what exists and reports where they DISAGREE, on
 * the principle that a region no enumeration claims is exactly where a blind
 * spot lives. These tests drive the disagreement functions on synthetic inputs,
 * because the property under test is the comparison logic, not this repository's
 * current shape — asserting against the real repo would make the test restate
 * today's file list and fail on every unrelated addition.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT_FOR_TEST = join(dirname(fileURLToPath(import.meta.url)), "..");
import {
  pathShapedStrings,
  nearestAncestorDir,
  computeDisagreements,
  isProjectTsconfig,
  enumerateGit,
} from "./repo-census.mjs";

describe("pathShapedStrings", () => {
  it("finds the shell-invoked script an import graph cannot see", () => {
    // `"bundle:types": "node scripts/bundle-types.mjs"` is how the missed file
    // is reached. There is no module edge, so madge and dependency-cruiser
    // never arrive at it from any entry point.
    expect(pathShapedStrings("node scripts/bundle-types.mjs")).toContain(
      "scripts/bundle-types.mjs",
    );
  });

  it("finds paths inside a longer command line and inside quotes", () => {
    const found = pathShapedStrings(
      `tsc -b && node scripts/a.mjs && node "e2e/report/dist/cli.js"`,
    );
    expect(found).toContain("scripts/a.mjs");
    expect(found).toContain("e2e/report/dist/cli.js");
  });

  it("does not invent paths from bare words, flags or version ranges", () => {
    expect(pathShapedStrings("npm run build --workspaces")).toEqual([]);
    expect(pathShapedStrings("typescript@6.0.3")).toEqual([]);
  });

  it("returns each path once however often it appears", () => {
    expect(pathShapedStrings("node scripts/a.mjs; node scripts/a.mjs")).toEqual(["scripts/a.mjs"]);
  });
});

describe("nearestAncestorDir", () => {
  const dirs = ["packages/cli", "packages/cli/src/doctor", "e2e/report"];

  it("picks the DEEPEST matching ancestor, not the first", () => {
    expect(nearestAncestorDir("packages/cli/src/doctor/checks/x.ts", dirs)).toBe(
      "packages/cli/src/doctor",
    );
  });

  it("returns undefined for a path under no listed directory", () => {
    // This is the `scripts/` case: no tsconfig anywhere is its ancestor.
    expect(nearestAncestorDir("scripts/bundle-types.mjs", dirs)).toBeUndefined();
  });

  it("does not treat a shared name prefix as an ancestor", () => {
    // `packages/cli-extra` must NOT match the `packages/cli` directory.
    expect(nearestAncestorDir("packages/cli-extra/src/x.ts", dirs)).toBeUndefined();
  });
});

describe("computeDisagreements", () => {
  /** A repo whose enumerations all agree — the control. */
  const agreeing = {
    diskFiles: ["packages/a/src/x.ts", "packages/a/package.json", "packages/a/tsconfig.json"],
    trackedFiles: ["packages/a/src/x.ts", "packages/a/package.json", "packages/a/tsconfig.json"],
    workspaceDirs: ["packages/a"],
    rootReferenceDirs: ["packages/a"],
    tsconfigDirs: ["packages/a"],
    namedPaths: new Map(),
  };

  it("reports nothing when every enumeration agrees", () => {
    const report = computeDisagreements(agreeing);
    for (const [kind, rows] of Object.entries(report)) {
      expect(rows, `expected no ${kind}`).toEqual([]);
    }
  });

  it("catches a tsconfig that exists but is not in the root build graph", () => {
    // The measured case: 28 tsconfigs exist here, 19 are referenced from root.
    const report = computeDisagreements({
      ...agreeing,
      diskFiles: [...agreeing.diskFiles, "e2e/live/tsconfig.json"],
      trackedFiles: [...agreeing.trackedFiles, "e2e/live/tsconfig.json"],
      tsconfigDirs: ["packages/a", "e2e/live"],
    });
    expect(report.tsconfigNotInRootGraph).toEqual(["e2e/live"]);
  });

  it("catches a build unit that is referenced but is not a workspace member", () => {
    // The measured case: `e2e/report` has no package.json, so a `packages/*`
    // enumeration omits it while the root tsconfig references it.
    const report = computeDisagreements({
      ...agreeing,
      rootReferenceDirs: ["packages/a", "e2e/report"],
      tsconfigDirs: ["packages/a", "e2e/report"],
      diskFiles: [...agreeing.diskFiles, "e2e/report/tsconfig.json"],
      trackedFiles: [...agreeing.trackedFiles, "e2e/report/tsconfig.json"],
    });
    expect(report.referencedButNotWorkspace).toEqual(["e2e/report"]);
  });

  it("catches source claimed by NO enumeration — the founding blind spot", () => {
    const report = computeDisagreements({
      ...agreeing,
      diskFiles: [...agreeing.diskFiles, "scripts/bundle-types.mjs"],
      trackedFiles: [...agreeing.trackedFiles, "scripts/bundle-types.mjs"],
    });
    expect(report.sourceClaimedByNothing).toContain("scripts/bundle-types.mjs");
  });

  it("does NOT report a file that only a string reference claims", () => {
    // Named by an npm script is a real claim, even with no module edge and no
    // tsconfig. It is reachable; it is just not reachable the usual way.
    const report = computeDisagreements({
      ...agreeing,
      diskFiles: [...agreeing.diskFiles, "scripts/bundle-types.mjs"],
      trackedFiles: [...agreeing.trackedFiles, "scripts/bundle-types.mjs"],
      namedPaths: new Map([["scripts/bundle-types.mjs", ["package.json:scripts.bundle:types"]]]),
    });
    expect(report.sourceClaimedByNothing).not.toContain("scripts/bundle-types.mjs");
    expect(report.claimedOnlyByString).toContainEqual({
      path: "scripts/bundle-types.mjs",
      namedBy: ["package.json:scripts.bundle:types"],
    });
  });

  it("catches a path named by a script that is not on disk at all", () => {
    const report = computeDisagreements({
      ...agreeing,
      namedPaths: new Map([["scripts/gone.mjs", ["package.json:scripts.x"]]]),
    });
    expect(report.namedButMissing).toEqual([
      { path: "scripts/gone.mjs", namedBy: ["package.json:scripts.x"] },
    ]);
  });

  it("catches a file present on disk that git neither tracks nor ignores", () => {
    const report = computeDisagreements({
      ...agreeing,
      diskFiles: [...agreeing.diskFiles, "packages/a/src/stray.ts"],
    });
    expect(report.onDiskUntracked).toEqual(["packages/a/src/stray.ts"]);
  });
});

describe("isProjectTsconfig", () => {
  it("accepts the project config every enumeration keys on", () => {
    expect(isProjectTsconfig("tsconfig.json")).toBe(true);
  });

  it("rejects the variants that are build INPUTS but not projects", () => {
    // Found by running the census against this repository and comparing its
    // tsconfig count against `find -name 'tsconfig*.json'`: the census counted
    // 27 where 30 files exist. `tsconfig.base.json` is extended by all 19 build
    // units and sits at the repo root, outside every unit's `src/` — a single
    // edit to it changes every build and moves nothing any src-walk observes.
    // Counting it as a project would be wrong; ignoring it entirely was the
    // census's own blind spot.
    expect(isProjectTsconfig("tsconfig.base.json")).toBe(false);
    expect(isProjectTsconfig("tsconfig.dts.json")).toBe(false);
  });

  it("rejects unrelated json", () => {
    expect(isProjectTsconfig("package.json")).toBe(false);
  });
});

describe("computeDisagreements — config inputs outside the project graph", () => {
  const base = {
    diskFiles: ["packages/a/src/x.ts", "packages/a/tsconfig.json"],
    trackedFiles: ["packages/a/src/x.ts", "packages/a/tsconfig.json"],
    workspaceDirs: ["packages/a"],
    rootReferenceDirs: ["packages/a"],
    tsconfigDirs: ["packages/a"],
    namedPaths: new Map(),
  };

  it("reports a tsconfig variant that is an input to every build but a project in none", () => {
    const report = computeDisagreements({
      ...base,
      variantConfigFiles: ["tsconfig.base.json", "packages/cli/tsconfig.dts.json"],
    });
    expect(report.configInputsOutsideProjectGraph).toEqual([
      "tsconfig.base.json",
      "packages/cli/tsconfig.dts.json",
    ]);
  });

  it("reports none when there are no variants", () => {
    expect(computeDisagreements(base).configInputsOutsideProjectGraph).toEqual([]);
  });
});

describe("defects found by running the census against this repository", () => {
  const base = {
    diskFiles: ["packages/a/src/x.ts"],
    trackedFiles: ["packages/a/src/x.ts"],
    workspaceDirs: ["packages/a"],
    rootReferenceDirs: ["packages/a"],
    tsconfigDirs: ["packages/a"],
    namedPaths: new Map(),
  };

  it("normalises a leading ./ so an existing file is not reported missing", () => {
    // Measured: the first run reported `./packages/cli/package.json` and
    // `./.github/workflows/release-e2e.yml` as "named but NOT on disk". Both
    // plainly exist; the workflows write them with a `./` prefix. A tool whose
    // job is to stop confident wrong answers was giving one.
    expect(pathShapedStrings("node ./scripts/a.mjs")).toEqual(["scripts/a.mjs"]);
  });

  it("does not report a gitignored build artifact as missing", () => {
    // Measured: `packages/gates/dist/drift/cli.js` and `e2e/report/dist/cli.js`
    // were reported missing. They are build output — present on disk, and
    // ignored. `namedButMissing` must ask "is it on disk", not "is it on disk
    // and not ignored", or every named build artifact is a false positive.
    const report = computeDisagreements({
      ...base,
      ignoredOnDisk: ["packages/a/dist/cli.js"],
      namedPaths: new Map([["packages/a/dist/cli.js", ["package.json:scripts.start"]]]),
    });
    expect(report.namedButMissing).toEqual([]);
  });

  it("still reports a named path that exists nowhere at all", () => {
    const report = computeDisagreements({
      ...base,
      ignoredOnDisk: ["packages/a/dist/cli.js"],
      namedPaths: new Map([["packages/a/dist/gone.js", ["package.json:scripts.start"]]]),
    });
    expect(report.namedButMissing).toEqual([
      { path: "packages/a/dist/gone.js", namedBy: ["package.json:scripts.start"] },
    ]);
  });
});

describe("the census cannot be pointed at the wrong repository", () => {
  /**
   * ⚠️ CORRECTNESS, NOT COMPLIANCE. git resolves which repository it operates
   * on from `GIT_DIR`/`GIT_WORK_TREE` BEFORE it consults the working directory,
   * and it exports `GIT_DIR` into every hook it runs — including this repo's
   * `pre-push`. A census run from a hook would enumerate whatever repository
   * the hook was pointed at and report it as this one: a confidently wrong
   * enumeration, which is precisely the failure this file exists to prevent.
   *
   * Found by `@crabgic/testkit`'s `git-spawn-hygiene.test.ts`, whose repo-wide
   * scan flagged this file on the way in — the guard biting is why it exists.
   */
  it("enumerates THIS repo even with GIT_DIR aimed elsewhere", () => {
    const decoy = mkdtempSync(join(tmpdir(), "census-decoy-"));
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy, "nonexistent.git");
    try {
      const { trackedFiles } = enumerateGit(REPO_ROOT_FOR_TEST);
      expect(trackedFiles).toContain("scripts/repo-census.mjs");
      expect(trackedFiles.length).toBeGreaterThan(1000);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});

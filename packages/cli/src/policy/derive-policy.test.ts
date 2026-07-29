import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { derivePolicy } from "./derive-policy.js";

let dir: string;

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function derive(dirs: readonly string[]) {
  return derivePolicy({ ...BASE, projectDir: dir, listDirectories: () => dirs });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eo-derive-"));
});

// Roast round 23 found ~15,800 leaked `eo-*` directories in /tmp across the
// repo's suites -- 8,200 from this prefix alone. `beforeEach` created one per
// test and nothing ever removed it, the same class round 21 fixed in the
// sandbox self-test and only there.
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("derivePolicy — paths", () => {
  it("grants the source directories the repo actually has", () => {
    const { policy } = derive(["src", "docs", "node_modules", ".git"]);
    expect(policy.allowedPathPrefixes).toEqual(["src", "docs"]);
  });

  it("grants nothing for a directory the repo does not have", () => {
    expect(derive(["src"]).policy.allowedPathPrefixes).toEqual(["src"]);
  });

  /**
   * Scratch paths are granted whether or not they exist: a build output
   * directory is created BY the build, so requiring it at install time would
   * deny exactly the directory the first run needs.
   */
  it("grants scratch paths that do not exist yet", () => {
    const { policy } = derive(["src"]);
    expect(policy.allowedWriteScratchPaths).toContain("dist");
    expect(policy.allowedWriteScratchPaths).toContain("coverage");
  });
});

describe("derivePolicy — commands", () => {
  function withScripts(scripts: Record<string, string>) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
    return derive(["src"]).policy;
  }

  /** Read-only inspections a worker needs to describe its own change; the sandbox bounds writes regardless. */
  it("always grants the two read-only git inspections", () => {
    expect(derive(["src"]).policy.allowedCommands).toEqual(["git status", "git diff"]);
  });

  it("grants npm run test only when the project declares a test script", () => {
    expect(withScripts({ build: "tsc" }).allowedCommands).not.toContain("npm run test");
    expect(withScripts({ test: "vitest" }).allowedCommands).toContain("npm run test");
  });

  it("grants npm run build only when the project declares a build script", () => {
    expect(withScripts({ test: "vitest" }).allowedCommands).not.toContain("npm run build");
    expect(withScripts({ build: "tsc" }).allowedCommands).toContain("npm run build");
  });

  it("survives an unreadable or malformed package.json without granting anything extra", () => {
    writeFileSync(join(dir, "package.json"), "{not json");
    expect(derive(["src"]).policy.allowedCommands).toEqual(["git status", "git diff"]);
  });
});

describe("derivePolicy — what it refuses to guess", () => {
  /**
   * There is no signal in a repository that distinguishes "this project talks
   * to the network" from "this project may talk to any destination without
   * review". Guessing in that direction is the one place a wrong default is
   * unrecoverable, so these stay empty and are widened by hand or not at all.
   */
  it("never derives network, credential, remote-resource or socket authority", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" }, dependencies: { axios: "^1" } }),
    );
    const { policy } = derive(["src"]);

    expect(policy.allowedNetworkDestinations).toEqual([]);
    expect(policy.allowedCredentialReferences).toEqual([]);
    expect(policy.allowedRemoteResourceReferences).toEqual([]);
    expect(policy.allowUnixSockets).toBe(false);
  });
});

describe("derivePolicy — vacuity", () => {
  /**
   * Roast round 1, F9: an all-empty policy passes every structural check a
   * doctor can make -- it exists, it parses, it is 0600, it is untracked --
   * while refusing every dispatch. A repo with no recognisable source
   * directory derives exactly that, so the caller must be told rather than
   * left to write it silently.
   */
  it("reports a repo with no recognisable source directory as vacuous", () => {
    expect(derive([]).vacuous).toBe(true);
    expect(derive(["node_modules", ".git"]).vacuous).toBe(true);
  });

  it("is not vacuous once any source directory is present", () => {
    expect(derive(["src"]).vacuous).toBe(false);
  });

  /** Scratch paths alone are not enough: a run that may write nowhere real accomplishes nothing. */
  it("is vacuous even though scratch paths are always granted", () => {
    const { policy, vacuous } = derive([]);
    expect(policy.allowedWriteScratchPaths.length).toBeGreaterThan(0);
    expect(vacuous).toBe(true);
  });
});

/**
 * Roast round 3, F1. On this very repo every package sets `outDir: "./dist"`,
 * so `tsc -b` writes `packages/<name>/dist` for all 15 projects -- none of
 * which a top-level `dist` grant covers, and the top-level `dist` it does
 * grant does not exist here at all. So `npm run build`, one of only two
 * grantable build commands, failed under the narrowed sandbox at any policy
 * setting the owner could express: `packages/<name>/dist` is a glob and grants
 * nothing.
 */
describe("derivePolicy — workspace build output", () => {
  function deriveWorkspace(top: readonly string[], children: Record<string, string[]>) {
    return derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) => {
        if (path === dir) return top;
        for (const [container, kids] of Object.entries(children)) {
          if (path.endsWith(container)) return kids;
        }
        return [];
      },
    });
  }

  it("grants each workspace package its own build output", () => {
    const { policy } = deriveWorkspace(["packages"], { packages: ["cli", "contracts"] });

    expect(policy.allowedWriteScratchPaths).toContain("packages/cli/dist");
    expect(policy.allowedWriteScratchPaths).toContain("packages/contracts/dist");
    expect(policy.allowedWriteScratchPaths).toContain("packages/cli/coverage");
  });

  it("covers apps/ as well as packages/", () => {
    const { policy } = deriveWorkspace(["apps"], { apps: ["web"] });
    expect(policy.allowedWriteScratchPaths).toContain("apps/web/dist");
  });

  /** Every entry stays a literal path — a glob would be dropped at compile time while still appearing in the policy an owner reads. */
  it("emits only literal paths, never a pattern", () => {
    const { policy } = deriveWorkspace(["packages"], { packages: ["cli"] });

    for (const path of policy.allowedWriteScratchPaths) {
      expect(path).not.toMatch(/[*?[\]{}]/);
    }
  });

  it("adds nothing for a repo with no workspace container", () => {
    const flat = derive(["src"]).policy.allowedWriteScratchPaths;
    expect(flat.every((p) => !p.startsWith("packages/"))).toBe(true);
  });
});

/**
 * Roast round 4. The first version emitted every scratch name for every
 * workspace child -- 153 entries on this repo -- which install prints one per
 * line before a single `yes`, pushing the paths and commands sections off the
 * screen. "Literal paths, which is what makes a policy readable" was the
 * stated justification; at 153 lines it was precisely not that.
 */
describe("derivePolicy — the policy stays readable", () => {
  function deriveWide(count: number) {
    const children = Array.from({ length: count }, (_, i) => `pkg${i}`);
    return derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) => (path === dir ? ["packages"] : children),
    }).policy;
  }

  it("emits two outputs per package, not one per candidate name", () => {
    const policy = deriveWide(3);
    const perPackage = policy.allowedWriteScratchPaths.filter((p) =>
      p.startsWith("packages/pkg0/"),
    );
    expect(perPackage).toEqual(["packages/pkg0/dist", "packages/pkg0/coverage"]);
  });

  it("caps a very large monorepo rather than emitting thousands of lines", () => {
    const policy = deriveWide(500);
    const workspaceEntries = policy.allowedWriteScratchPaths.filter((p) =>
      p.startsWith("packages/"),
    );
    expect(workspaceEntries.length).toBeLessThanOrEqual(80);
  });

  it("de-duplicates", () => {
    const policy = deriveWide(3);
    expect(new Set(policy.allowedWriteScratchPaths).size).toBe(
      policy.allowedWriteScratchPaths.length,
    );
  });
});

/**
 * Roast round 5. Two findings this suite structurally could not see: it never
 * exercised two containers, and it never checked the deriver against the list
 * of directories provisioning actually creates.
 */
describe("derivePolicy — round 5", () => {
  /**
   * The scratch list and git-engine's WORKTREE_LOCAL_MODULE_DIRS must move
   * together. Round 3 added .vite/.vite-temp to the provisioner and left the
   * deriver behind, so provisioning anchored a .cache this repo does not have
   * while omitting the two vitest actually writes.
   */
  it("grants every module directory the provisioner creates", async () => {
    const { WORKTREE_LOCAL_MODULE_DIRS } = await import("@crabgic/git-engine");
    const { policy } = derive(["src"]);

    for (const dir of WORKTREE_LOCAL_MODULE_DIRS) {
      expect(policy.allowedWriteScratchPaths).toContain(`node_modules/${dir}`);
    }
  });

  /**
   * The cap used to return from the whole function mid-container, so 45
   * packages plus 3 apps granted every package and nothing at all for apps --
   * silently, with no marker in the policy an owner reads.
   */
  it("shares the cap between containers instead of starving the second", () => {
    const packages = Array.from({ length: 45 }, (_, i) => `pkg${i}`);
    const { policy } = derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) =>
        path === dir ? ["packages", "apps"] : path.endsWith("apps") ? ["web", "admin"] : packages,
    });

    expect(policy.allowedWriteScratchPaths).toContain("apps/web/dist");
    expect(policy.allowedWriteScratchPaths).toContain("apps/admin/dist");
    expect(policy.allowedWriteScratchPaths.some((p) => p.startsWith("packages/"))).toBe(true);
  });

  /** readdir order is filesystem-dependent, so an unsorted cap made the policy -- and its digest -- differ between machines for one repo. */
  it("selects the same packages regardless of listing order", () => {
    const forward = ["a", "b", "c", "d"];
    const backward = [...forward].reverse();
    const pick = (order: string[]) =>
      derivePolicy({
        ...BASE,
        projectDir: dir,
        listDirectories: (path) => (path === dir ? ["packages"] : order),
      }).policy.allowedWriteScratchPaths;

    expect(pick(forward)).toEqual(pick(backward));
  });
});

/**
 * Roast round 6. The round-5 even split was measured and found to drop
 * packages that previously had grants: on a 60-package repo, adding a single
 * apps/ directory halved the packages that got a build-output grant, from 40
 * to 20 -- twenty packages whose tsc output silently fell outside allowWrite.
 * The old test passed at 20/45 and would have passed at 1/45.
 */
describe("derivePolicy — the cap fills its budget", () => {
  function grantsFor(counts: Record<string, number>) {
    const children = Object.fromEntries(
      Object.entries(counts).map(([k, n]) => [k, Array.from({ length: n }, (_, i) => `${k}${i}`)]),
    );
    const policy = derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) => {
        if (path === dir) return Object.keys(counts);
        for (const [container, kids] of Object.entries(children)) {
          if (path.endsWith(container)) return kids;
        }
        return [];
      },
    }).policy;
    return new Set(
      policy.allowedWriteScratchPaths
        .filter((p) => p.endsWith("/dist") && p.includes("/"))
        .filter((p) => Object.keys(counts).some((c) => p.startsWith(`${c}/`))),
    );
  }

  it("does not shrink one container's grants because another exists", () => {
    const alone = grantsFor({ packages: 60 });
    const together = grantsFor({ packages: 60, apps: 1 });

    const packagesAlone = [...alone].filter((p) => p.startsWith("packages/")).length;
    const packagesTogether = [...together].filter((p) => p.startsWith("packages/")).length;

    // An even split gave 20 here against 40 alone.
    expect(packagesTogether).toBeGreaterThanOrEqual(packagesAlone - 1);
  });

  it("fills the budget instead of wasting a small container's quota", () => {
    // 3 apps + 45 packages: an even split granted 23 of 48 and left 17 unused.
    expect(grantsFor({ packages: 45, apps: 3 }).size).toBe(40);
  });

  it("never exceeds the cap", () => {
    expect(grantsFor({ packages: 500, apps: 500 }).size).toBe(40);
  });

  it("keeps every container represented", () => {
    const grants = grantsFor({ packages: 100, apps: 2 });
    expect([...grants].some((p) => p.startsWith("apps/"))).toBe(true);
  });
});

/**
 * The deriver must never emit a policy its own doctor rejects -- that would
 * be a self-inflicted broken install: `crabgic install` writes it, `crabgic
 * doctor` immediately calls it broken, and the owner has done nothing wrong.
 *
 * Round 9 added a usability check for `allowedWriteScratchPaths`; this pins
 * the two together so a future candidate directory carrying a glob, a leading
 * slash or a `..` cannot be added on one side without the other noticing.
 */
describe("derivePolicy — never emits what its own doctor rejects", () => {
  const SHAPES: Record<string, { top: string[]; kids: string[] }> = {
    flat: { top: ["src", "docs"], kids: [] },
    monorepo: { top: ["packages", "apps", "docs"], kids: ["cli", "contracts", "web"] },
    empty: { top: [], kids: [] },
    "unusual package names": { top: ["packages"], kids: ["a b", ".hidden", "x"] },
    // Round 10: these are all LEGAL Linux directory names, and all three
    // previously produced grants the doctor then rejected with a repair step
    // the owner could not follow.
    "package names that cannot appear in a grant": {
      top: ["packages"],
      kids: ["old[1]", "a{b}", "star*", "q?", "back\\slash", "fine"],
    },
  };

  it.each(Object.keys(SHAPES))("every derived path is usable for the %s shape", async (name) => {
    const { isUsablePathPrefix } = await import("@crabgic/contracts");
    const shape = SHAPES[name]!;
    const { policy } = derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) => (path === dir ? shape.top : shape.kids),
    });

    expect(policy.allowedWriteScratchPaths.filter((e) => !isUsablePathPrefix(e))).toEqual([]);
    expect(policy.allowedPathPrefixes.filter((e) => !isUsablePathPrefix(e))).toEqual([]);
  });
});

/**
 * Two properties of the skip that are easy to get wrong and invisible in the
 * output: it must validate everything it emits, and it must not spend a
 * capped slot on a name it then discards.
 */
describe("derivePolicy — the unusable-name skip", () => {
  function deriveWith(children: readonly string[]) {
    return derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) => (path === dir ? ["packages"] : [...children]),
    }).policy.allowedWriteScratchPaths.filter((p) => p.startsWith("packages/"));
  }

  it("emits nothing at all for a name it cannot grant", () => {
    const grants = deriveWith(["old[1]", "fine"]);
    expect(grants.some((p) => p.includes("old[1]"))).toBe(false);
    expect(grants).toContain("packages/fine/dist");
    expect(grants).toContain("packages/fine/coverage");
  });

  /**
   * A skipped name must not consume a slot, or a repo with unusable names
   * would silently lose grants for perfectly good packages further down the
   * list.
   */
  it("does not spend a capped slot on a skipped name", () => {
    const usable = Array.from({ length: 40 }, (_, i) => `pkg${String(i).padStart(2, "0")}`);
    const withJunk = deriveWith(["a[1]", "b{2}", "c*3", ...usable]);

    // All 40 usable packages still get their grants despite three junk names
    // sorting ahead of some of them.
    expect(withJunk.filter((p) => p.endsWith("/dist"))).toHaveLength(40);
  });

  /**
   * RENAMED after round 12. This was titled "validates every output it emits,
   * not just the first", which it does not test: appending `/dist` or
   * `/coverage` cannot change any clause of `normalizePathPrefix`, so the
   * `every` is provably equivalent to checking one -- measured at 0
   * disagreements over 16,682 (container, child) pairs, and reverting to a
   * dist-only check survives this suite.
   *
   * The `every` stays, because it is the form that keeps covering the emitted
   * set if `WORKSPACE_SCRATCH_OUTPUTS` ever gains a member with a
   * metacharacter. But a title claiming coverage the assertion cannot provide
   * is round 10's "untested headline" in weaker form, so it now says what it
   * actually pins.
   */
  it("rejects a child name for every output, since all outputs share its prefix", () => {
    const grants = deriveWith(["q?mark"]);
    expect(grants).toEqual([]);
  });
});

/**
 * Roast round 12. Mutating the skip's `continue` to `break` SURVIVED all 654
 * CLI tests, and it is not an equivalent mutant: with
 * `packages=["old[1]","cli","core"]` and `apps=["web","admin","docs"]` it
 * drops `apps/web/dist` entirely.
 *
 * That is exactly the failure rounds 5 and 6 measured and fixed -- "twenty
 * packages whose tsc output silently fell outside allowWrite". The three skip
 * tests written in round 11 all inject a SINGLE container, so the skip's
 * interaction with the round-robin, which is the thing round 6 exists to
 * protect, was never exercised.
 */
describe("derivePolicy — the skip must not abandon the round-robin", () => {
  function deriveTwoContainers(packages: readonly string[], apps: readonly string[]) {
    return derivePolicy({
      ...BASE,
      projectDir: dir,
      listDirectories: (path) =>
        path === dir ? ["packages", "apps"] : path.endsWith("apps") ? [...apps] : [...packages],
    }).policy.allowedWriteScratchPaths;
  }

  it("keeps granting the other container after skipping an unusable name", () => {
    const grants = deriveTwoContainers(["old[1]", "cli", "core"], ["web", "admin", "docs"]);

    // `break` would abandon the whole loop at the junk name and lose these.
    expect(grants).toContain("apps/web/dist");
    expect(grants).toContain("apps/admin/dist");
    expect(grants).toContain("packages/cli/dist");
    expect(grants.some((p) => p.includes("old[1]"))).toBe(false);
  });

  it("skips a junk name in EITHER container without losing the other", () => {
    const grants = deriveTwoContainers(["cli"], ["bad{1}", "web"]);

    expect(grants).toContain("packages/cli/dist");
    expect(grants).toContain("apps/web/dist");
    expect(grants.some((p) => p.includes("bad{1}"))).toBe(false);
  });

  it("survives a junk name sorting first in both containers", () => {
    const grants = deriveTwoContainers(["[a]", "cli"], ["[b]", "web"]);

    expect(grants).toContain("packages/cli/dist");
    expect(grants).toContain("apps/web/dist");
  });
});

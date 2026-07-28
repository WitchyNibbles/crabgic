import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
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

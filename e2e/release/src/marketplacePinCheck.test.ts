import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkMarketplacePin } from "./marketplacePinCheck.js";

const execFileAsync = promisify(execFile);

const RC = "a".repeat(40);

const dirs: string[] = [];
async function makePluginRoot(commit: string | undefined): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-marketplace-pin-"));
  dirs.push(dir);
  if (commit !== undefined) {
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(dir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
        name: "m",
        description: "d",
        owner: { name: "o", email: "o@example.invalid" },
        plugins: [
          {
            name: "p",
            source: "./",
            description: "d",
            version: "1.0.0",
            license: "Apache-2.0",
            commit,
            digest: "somedigest",
          },
        ],
      }),
      "utf8",
    );
  }
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("checkMarketplacePin — unit", () => {
  it("reports an unreadable/absent marketplace.json with a quotable reason", async () => {
    const pluginRoot = await makePluginRoot(undefined);
    const result = await checkMarketplacePin({
      pluginRoot,
      repoRoot: "/nonexistent",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => RC,
    });
    expect(result.readable).toBe(false);
    expect(result.pinned).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("marketplace.json");
  });

  it("reports the all-zero placeholder commit as NOT SHA-pinned, and adds no follow-on noise", async () => {
    const pluginRoot = await makePluginRoot("0".repeat(40));
    const result = await checkMarketplacePin({
      pluginRoot,
      repoRoot: "/nonexistent",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => undefined,
    });
    expect(result.readable).toBe(true);
    expect(result.pinned).toBe(false);
    expect(result.resolvesInRepo).toBe(false);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("all-zero placeholder");
  });

  it("reports a pinned commit that does not resolve to any commit in this repository", async () => {
    const pluginRoot = await makePluginRoot("c".repeat(40));
    const result = await checkMarketplacePin({
      pluginRoot,
      repoRoot: "/nonexistent",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => undefined,
    });
    expect(result.pinned).toBe(true);
    expect(result.resolvesInRepo).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("does not resolve");
  });

  it("reports a resolvable pinned commit that is NOT the release candidate", async () => {
    const pluginRoot = await makePluginRoot("c".repeat(40));
    const result = await checkMarketplacePin({
      pluginRoot,
      repoRoot: "/nonexistent",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => "c".repeat(40),
    });
    expect(result.resolvesInRepo).toBe(true);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("release candidate");
  });

  it("passes with zero reasons when the committed entry is pinned to the resolvable release candidate", async () => {
    const pluginRoot = await makePluginRoot(RC);
    const result = await checkMarketplacePin({
      pluginRoot,
      repoRoot: "/nonexistent",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => RC,
    });
    expect(result.pinned).toBe(true);
    expect(result.resolvesInRepo).toBe(true);
    expect(result.matchesReleaseCandidate).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe("checkMarketplacePin — this repo's own real, committed marketplace.json", () => {
  /**
   * REWRITTEN at the v1.0.0 cut, which pinned the entry at the release
   * commit. This asserted the all-zero placeholder — honest while the pin
   * was an owner release action, and false as soon as it was cut.
   */
  it("finds the committed entry pinned at a real commit, and matching the candidate it names", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const pinned = JSON.parse(
      await readFile(
        resolve(repoRoot, "packages", "plugin", ".claude-plugin", "marketplace.json"),
        "utf-8",
      ),
    ).plugins[0].commit as string;

    const result = await checkMarketplacePin({
      pluginRoot: resolve(repoRoot, "packages", "plugin"),
      repoRoot,
      releaseCandidateObjectId: pinned,
    });
    expect(result.pinned).toBe(true);
    expect(result.resolvesInRepo).toBe(true);
    expect(result.matchesReleaseCandidate).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("still reports the committed pin naming a commit other than the release candidate", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const result = await checkMarketplacePin({
      pluginRoot: resolve(repoRoot, "packages", "plugin"),
      repoRoot,
      releaseCandidateObjectId: "b".repeat(40),
    });
    expect(result.pinned).toBe(true);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.reasons).toHaveLength(1);
  });
});

/**
 * The release-cut self-reference: writing the pin CHANGES the commit, so the
 * commit carrying the pin can never be the one the pin names. Under plain
 * equality this clause was unsatisfiable and every release cut so far failed
 * it for that reason alone. The rule is now "the pin names the candidate, OR
 * an ancestor from which nothing the plugin distributes has changed".
 */
describe("checkMarketplacePin — the release-cut self-reference", () => {
  const CANDIDATE = "c".repeat(40);
  const PARENT = "d".repeat(40);

  async function checkWithDiff(
    changedPaths: readonly string[] | undefined,
  ): ReturnType<typeof checkMarketplacePin> {
    return checkMarketplacePin({
      pluginRoot: await makePluginRoot(PARENT),
      repoRoot: "/repo",
      releaseCandidateObjectId: CANDIDATE,
      resolveCommit: async () => PARENT,
      resolveChangedPaths: async () => changedPaths,
    });
  }

  it("accepts a pin one commit back when the only divergence is the marketplace entry itself", async () => {
    const result = await checkWithDiff(["packages/plugin/.claude-plugin/marketplace.json"]);
    expect(result.matchesReleaseCandidate).toBe(true);
    expect(result.pinEquivalence).toBe("digest-neutral-ancestor");
    expect(result.reasons).toEqual([]);
  });

  it("records an exact pin distinctly from the tolerated one", async () => {
    const result = await checkMarketplacePin({
      pluginRoot: await makePluginRoot(CANDIDATE),
      repoRoot: "/repo",
      releaseCandidateObjectId: CANDIDATE,
      resolveCommit: async () => CANDIDATE,
      resolveChangedPaths: async () => {
        throw new Error("must not be consulted when the pin is exact");
      },
    });
    expect(result.pinEquivalence).toBe("exact");
    expect(result.reasons).toEqual([]);
  });

  it("REJECTS an ancestor whose range touches a packaged plugin file", async () => {
    // A pin left at a previous release: the intervening range changed real
    // distributed content, so the entry does not describe this candidate.
    const result = await checkWithDiff([
      "packages/plugin/.claude-plugin/marketplace.json",
      "packages/plugin/statusline/crabgic-statusline.mjs",
    ]);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.pinEquivalence).toBe("mismatched");
    expect(result.reasons[0]).toContain("crabgic-statusline.mjs");
  });

  it("REJECTS an ancestor whose range touches anything outside the plugin", async () => {
    const result = await checkWithDiff(["packages/cli/src/installer/install.ts"]);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.reasons[0]).toContain("install.ts");
  });

  it("REJECTS a pinned commit that is not an ancestor of the candidate", async () => {
    const result = await checkWithDiff(undefined);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.reasons[0]).toContain("not an ancestor");
  });

  it("REJECTS an identical-tree commit rather than treating an empty diff as equivalence", async () => {
    // An empty diff means the pin names a different commit with the same
    // tree — a rewrite, not the release cut. Accepting it would let any
    // cherry-pick or revert pair satisfy the clause.
    const result = await checkWithDiff([]);
    expect(result.matchesReleaseCandidate).toBe(false);
    expect(result.reasons[0]).toContain("identical trees");
  });
});

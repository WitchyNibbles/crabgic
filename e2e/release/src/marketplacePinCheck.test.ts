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

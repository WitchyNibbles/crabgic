import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { checkReleaseTag } from "./releaseTagCheck.js";
import { realGitCommitResolver } from "./gitCommitResolver.js";

const execFileAsync = promisify(execFile);

const RC = "a".repeat(40);

describe("checkReleaseTag — unit (injected commit resolver)", () => {
  it("reports a missing tag with a quotable reason", async () => {
    const result = await checkReleaseTag({
      repoRoot: "/nonexistent",
      tagName: "v1.0.0",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => undefined,
    });
    expect(result.exists).toBe(false);
    expect(result.pointsAtReleaseCandidate).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("v1.0.0");
  });

  it("reports a tag that exists but points at a DIFFERENT commit than the release candidate", async () => {
    const result = await checkReleaseTag({
      repoRoot: "/nonexistent",
      tagName: "v1.0.0",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => "b".repeat(40),
    });
    expect(result.exists).toBe(true);
    expect(result.pointsAtReleaseCandidate).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("b".repeat(40));
  });

  it("passes with zero reasons when the tag exists and points at the release candidate", async () => {
    const result = await checkReleaseTag({
      repoRoot: "/nonexistent",
      tagName: "v1.0.0",
      releaseCandidateObjectId: RC,
      resolveCommit: async () => RC,
    });
    expect(result.exists).toBe(true);
    expect(result.pointsAtReleaseCandidate).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe("realGitCommitResolver — genuine integration (real git, this repo)", () => {
  it("resolves HEAD to a full 40-hex commit SHA", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const resolved = await realGitCommitResolver(repoRoot, "HEAD");
    expect(resolved).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns undefined (never throws) for a ref that names no commit", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    await expect(
      realGitCommitResolver(repoRoot, "refs/tags/eo-definitely-not-a-real-tag"),
    ).resolves.toBeUndefined();
  });
});

describe("checkReleaseTag — this repo's own real state", () => {
  it("FAILS today: no v1.0.0 tag exists in this repository", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const head = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
    ).stdout.trim();
    const result = await checkReleaseTag({
      repoRoot,
      tagName: "v1.0.0",
      releaseCandidateObjectId: head,
    });
    // Cutting the real tag is an owner release action, deliberately out of
    // scope here — this records the honest current state.
    expect(result.exists).toBe(false);
    expect(result.reasons).toHaveLength(1);
  });
});

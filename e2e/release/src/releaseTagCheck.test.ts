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
  /**
   * REWRITTEN at the v1.0.0 cut. This asserted `exists === false` — the
   * honest state while cutting the tag remained an owner release action —
   * and so failed the moment the tag was created. It now asserts the
   * property the criterion cares about: the release tag exists AND points at
   * the object being released, which is the part a bare existence check
   * would miss.
   */
  it("finds the real v1.0.0 tag, pointing at the commit it names", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const tagged = (
      await execFileAsync("git", ["rev-list", "-n1", "v1.0.0"], { cwd: repoRoot })
    ).stdout.trim();

    const result = await checkReleaseTag({
      repoRoot,
      tagName: "v1.0.0",
      releaseCandidateObjectId: tagged,
    });
    expect(result.exists).toBe(true);
    expect(result.pointsAtReleaseCandidate).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("still reports the tag pointing somewhere other than the release candidate", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const result = await checkReleaseTag({
      repoRoot,
      tagName: "v1.0.0",
      releaseCandidateObjectId: "b".repeat(40),
    });
    expect(result.exists).toBe(true);
    expect(result.pointsAtReleaseCandidate).toBe(false);
    expect(result.reasons).toHaveLength(1);
  });
});

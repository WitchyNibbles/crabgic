import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { realGitCommitResolver } from "./gitCommitResolver.js";

const execFileAsync = promisify(execFile);

/**
 * `gitCommitResolver.ts` was covered only incidentally, through
 * `releaseTagCheck.test.ts`. It is the seam the WHOLE release gate hangs
 * off — `releaseGateSummary.ts` throws `UnresolvableCommitIshError` purely
 * on its `undefined` — so it gets its own direct coverage here, including
 * the "not a repository at all" path that no incidental caller reaches.
 */
let repoRoot: string;
beforeAll(async () => {
  repoRoot = (
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
  ).stdout.trim();
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("realGitCommitResolver", () => {
  it("resolves a real ref to its full 40-hex commit id", async () => {
    const resolved = await realGitCommitResolver(repoRoot, "HEAD");
    const expected = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
    ).stdout.trim();
    expect(resolved).toBe(expected);
    expect(resolved).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns undefined — never throws — for a ref that names nothing, so the gate reports rather than aborts", async () => {
    await expect(
      realGitCommitResolver(repoRoot, "eo-definitely-not-a-real-ref"),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for a well-formed but absent 40-hex object id (an unpinned/foreign marketplace commit)", async () => {
    await expect(realGitCommitResolver(repoRoot, "0".repeat(40))).resolves.toBeUndefined();
  });

  it("returns undefined when repoRoot is not a git repository at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eo-git-commit-resolver-"));
    dirs.push(dir);
    await expect(realGitCommitResolver(dir, "HEAD")).resolves.toBeUndefined();
  });
});

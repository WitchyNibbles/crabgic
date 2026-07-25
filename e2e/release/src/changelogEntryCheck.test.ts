import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkChangelogEntry } from "./changelogEntryCheck.js";

const execFileAsync = promisify(execFile);

const dirs: string[] = [];
async function makeRepoRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eo-changelog-check-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("checkChangelogEntry — unit", () => {
  it("reports a missing CHANGELOG.md with a quotable reason", async () => {
    const repoRoot = await makeRepoRoot();
    const result = checkChangelogEntry({ repoRoot, version: "1.0.0" });
    expect(result.fileExists).toBe(false);
    expect(result.hasVersionEntry).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("CHANGELOG.md");
  });

  it("reports a CHANGELOG.md that exists but has no entry for the release version", async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(join(repoRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.9.0\n\n- something\n");
    const result = checkChangelogEntry({ repoRoot, version: "1.0.0" });
    expect(result.fileExists).toBe(true);
    expect(result.hasVersionEntry).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("1.0.0");
  });

  it("passes with zero reasons for a CHANGELOG.md carrying a v1.0.0 heading", async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(join(repoRoot, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- first release\n");
    const result = checkChangelogEntry({ repoRoot, version: "1.0.0" });
    expect(result.hasVersionEntry).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("accepts the common `## [v1.0.0] - date` heading dialect too", async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(
      join(repoRoot, "CHANGELOG.md"),
      "## [v1.0.0] - 2026-07-25\n\n- first release\n",
    );
    const result = checkChangelogEntry({ repoRoot, version: "1.0.0" });
    expect(result.hasVersionEntry).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("does not accept a longer version that merely starts with the release version", async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(join(repoRoot, "CHANGELOG.md"), "## 1.0.0-rc.1\n\n- release candidate\n");
    const result = checkChangelogEntry({ repoRoot, version: "1.0.0" });
    expect(result.hasVersionEntry).toBe(false);
  });
});

describe("checkChangelogEntry — this repo's own real state", () => {
  it("FAILS today: this repository has no CHANGELOG.md at all", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const result = checkChangelogEntry({ repoRoot, version: "1.0.0" });
    // Writing a real CHANGELOG.md is an owner release action, deliberately
    // out of scope here — this records the honest current state.
    expect(result.fileExists).toBe(false);
    expect(result.reasons).toHaveLength(1);
  });
});

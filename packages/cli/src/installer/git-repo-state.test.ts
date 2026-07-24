import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { detectGitRepoState, detectMonorepo, performGitInit } from "./git-repo-state.js";

const execFileAsync = promisify(execFile);

const dirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eo-git-repo-state-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("detectGitRepoState", () => {
  it('reports "not-a-repo" for an empty directory with no .git at all', async () => {
    const dir = makeTmpDir();
    expect(await detectGitRepoState(dir)).toBe("not-a-repo");
  });

  it('reports "invalid-git" for a directory with a corrupt .git', async () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "not a valid git ref file at all");
    expect(await detectGitRepoState(dir)).toBe("invalid-git");
  });

  it('reports "unborn-head" for a freshly-initialized repo with zero commits', async () => {
    const dir = makeTmpDir();
    await execFileAsync("git", ["init"], { cwd: dir });
    expect(await detectGitRepoState(dir)).toBe("unborn-head");
  });

  it('reports "clean" for a repo with one commit and no working-tree changes', async () => {
    const dir = makeTmpDir();
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "a");
    await execFileAsync("git", ["add", "a.txt"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    expect(await detectGitRepoState(dir)).toBe("clean");
  });

  it('reports "dirty" for a repo with uncommitted working-tree changes', async () => {
    const dir = makeTmpDir();
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "a");
    await execFileAsync("git", ["add", "a.txt"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "modified");
    expect(await detectGitRepoState(dir)).toBe("dirty");
  });
});

describe("performGitInit", () => {
  it("initializes a real git repo", async () => {
    const dir = makeTmpDir();
    await performGitInit(dir);
    expect(await detectGitRepoState(dir)).toBe("unborn-head");
  });
});

describe("detectMonorepo", () => {
  it("is false for a directory with no nested package.json", () => {
    const dir = makeTmpDir();
    expect(detectMonorepo(dir)).toBe(false);
  });

  it("is true when a subdirectory has its own package.json", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, "packages", "sub"), { recursive: true });
    writeFileSync(join(dir, "packages", "sub", "package.json"), "{}");
    expect(detectMonorepo(dir)).toBe(true);
  });
});

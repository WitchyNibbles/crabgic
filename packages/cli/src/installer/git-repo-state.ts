/**
 * Git repo-state detection — roadmap/10-plugin-and-installer.md §Test plan,
 * Integration: "full installation matrix (empty dir, invalid `.git`, unborn
 * HEAD, dirty repo, monorepo, ...)." File-writing itself never depends on
 * git health (none of `CLAUDE.md`/`settings.json`/`.mcp.json`/`eo-*.md`
 * needs a working repo) — this module exists purely to REPORT which matrix
 * case applies, and to gate the one genuinely git-touching action
 * (`git init`) behind explicit approval for a non-repo target (§In scope,
 * "Non-Git projects").
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitRepoState = "not-a-repo" | "invalid-git" | "unborn-head" | "clean" | "dirty";

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ readonly ok: boolean; readonly stdout: string }> {
  try {
    const { stdout } = await execFileAsync("git", [...args], { cwd });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/** Detects which installation-matrix git state `targetDir` is in. Never throws — every branch is a real, reportable `GitRepoState`. */
export async function detectGitRepoState(targetDir: string): Promise<GitRepoState> {
  const insideWorkTree = await runGit(targetDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== "true") {
    return existsSync(join(targetDir, ".git")) ? "invalid-git" : "not-a-repo";
  }

  const head = await runGit(targetDir, ["rev-parse", "HEAD"]);
  if (!head.ok) return "unborn-head";

  const status = await runGit(targetDir, ["status", "--porcelain"]);
  return status.stdout.trim().length === 0 ? "clean" : "dirty";
}

/** `git init` in `targetDir` — called ONLY after `InstallerDependencies.confirmGitInit()` has explicitly returned `true` (roadmap/10 §In scope, "Non-Git projects: `git init` only after explicit approval"). This function itself never prompts, never commits, and never stages/adds anything — it is a bare `git init`, full stop. */
export async function performGitInit(targetDir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: targetDir });
}

function listDirs(dir: string): readonly string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "node_modules" && e.name !== ".git")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** True when a nested `package.json` exists 1-2 directories below `targetDir` (e.g. `packages/<name>/package.json`, the matrix's "monorepo" case) — informational only; never changes install behavior, since every artifact this installer writes is rooted at `targetDir` itself regardless of what nested packages exist. */
export function detectMonorepo(targetDir: string): boolean {
  for (const level1 of listDirs(targetDir)) {
    const level1Path = join(targetDir, level1);
    if (existsSync(join(level1Path, "package.json"))) return true;
    for (const level2 of listDirs(level1Path)) {
      if (existsSync(join(level1Path, level2, "package.json"))) return true;
    }
  }
  return false;
}

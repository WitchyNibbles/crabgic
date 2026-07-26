/**
 * Real, throwaway temp-repo fixture builders for the git-invariance +
 * neutral-rendering matrix — every builder does real filesystem/`git` work
 * via `@crabgic/git-engine`'s `createGitPlumbing` (argv-array only, no shell —
 * the exact plumbing wrapper 07/08 themselves use), never a mocked git.
 * Mirrors `packages/git-engine/src/test-support/fixture-repo.ts`'s own
 * documented conventions (that file is test-scaffolding-only, not part of
 * `@crabgic/git-engine`'s public barrel, so this project reproduces the same
 * small set of primitives rather than importing it).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitPlumbing, type GitPlumbing } from "@crabgic/git-engine";

export const plumbing: GitPlumbing = createGitPlumbing();

export interface TempFixture {
  readonly dir: string;
  cleanup(): Promise<void>;
}

export async function freshTmpDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `eo-git-matrix-${prefix}-`));
}

export function withCleanup(dir: string): TempFixture {
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface InitFixtureRepoOptions {
  readonly objectFormat?: "sha1" | "sha256";
}

/** Initializes a real git repo with a local, repo-scoped identity (never touches global git config) — optionally SHA-256, per `git init --object-format`. */
export async function initFixtureRepo(
  dir: string,
  options: InitFixtureRepoOptions = {},
): Promise<void> {
  const initArgs = ["init", "-q"];
  if (options.objectFormat !== undefined) initArgs.push(`--object-format=${options.objectFormat}`);
  await plumbing.run(initArgs, { cwd: dir });
  await plumbing.run(["config", "user.name", "EO Fixture"], { cwd: dir });
  await plumbing.run(["config", "user.email", "fixture@eo.invalid"], { cwd: dir });
  await plumbing.run(["config", "commit.gpgsign", "false"], { cwd: dir });
}

export async function writeFixtureFile(
  repoDir: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const fullPath = join(repoDir, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf8");
  return fullPath;
}

/** `git add -A && git commit -m <message> --no-verify`, returning the new commit's object id. `--no-verify` is deliberate: fixture commits are never subject to whatever real hooks a HOST'S global git config might install, only to the hooks this project explicitly installs and tests (see `hooks-filters-scenario.ts`, which never passes `--no-verify` on the commit whose hook-bypass it is proving). */
export async function commitAll(repoDir: string, message: string): Promise<string> {
  await plumbing.run(["add", "-A"], { cwd: repoDir });
  await plumbing.run(["commit", "-q", "-m", message, "--no-verify"], { cwd: repoDir });
  const result = await plumbing.run(["rev-parse", "HEAD"], { cwd: repoDir });
  return result.stdout.trim();
}

/** A real, committed HEAD-carrying commit, without `--no-verify` — used ONLY by the hooks-filters scenario, which needs a real hook to have a chance to fire. */
export async function commitAllHonoringHooks(repoDir: string, message: string): Promise<string> {
  await plumbing.run(["add", "-A"], { cwd: repoDir });
  await plumbing.run(["commit", "-q", "-m", message], { cwd: repoDir });
  const result = await plumbing.run(["rev-parse", "HEAD"], { cwd: repoDir });
  return result.stdout.trim();
}

export interface BasicFixtureRepo extends TempFixture {
  readonly headObjectId: string;
}

/** Builds a small, non-trivial fixture repo on branch `main`: one commit, two tracked files. */
export async function buildBasicFixtureRepo(): Promise<BasicFixtureRepo> {
  const dir = await freshTmpDir("basic");
  await initFixtureRepo(dir);
  await plumbing.run(["checkout", "-q", "-b", "main"], { cwd: dir });
  await writeFixtureFile(dir, "README.md", "# fixture\n");
  await writeFixtureFile(dir, "src/a.txt", "alpha\n");
  const headObjectId = await commitAll(dir, "initial commit");
  const { cleanup } = withCleanup(dir);
  return { dir, headObjectId, cleanup };
}

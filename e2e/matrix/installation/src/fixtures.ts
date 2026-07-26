/**
 * Real, throwaway temp-repo fixture builders for the installation matrix —
 * every builder below does real filesystem/`git` work (via `@crabgic/git-
 * engine`'s `createGitPlumbing`, argv-array only, no shell — the same
 * plumbing wrapper 07/08 use, never a re-implemented spawn call), never a
 * mocked git. Each returns `{ dir, cleanup }`; callers MUST call `cleanup`
 * (tests do so in a `finally`/`afterEach`).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitPlumbing, type GitPlumbing } from "@crabgic/git-engine";

export interface TempFixture {
  readonly dir: string;
  cleanup(): Promise<void>;
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `eo-install-matrix-${prefix}-`));
}

function withCleanup(dir: string): TempFixture {
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const plumbing: GitPlumbing = createGitPlumbing();

/** Scenario 1: a plain empty directory — no `.git` at all. */
export async function buildEmptyDir(): Promise<TempFixture> {
  const dir = await makeTempDir("empty");
  return withCleanup(dir);
}

/**
 * Scenario 2: a directory whose `.git` exists but is not a valid
 * repository (a plain file, not a real git-dir) — `git rev-parse
 * --is-inside-work-tree` fails, but `existsSync(join(dir, ".git"))` is
 * true, matching `detectGitRepoState`'s own documented "invalid-git"
 * branch (roadmap/10 §Test plan: "invalid `.git`").
 */
export async function buildInvalidGitDir(): Promise<TempFixture> {
  const dir = await makeTempDir("invalid-git");
  await writeFile(join(dir, ".git"), "not a real git directory\n", "utf8");
  return withCleanup(dir);
}

/** Scenario 3: `git init`, no commits yet — HEAD is unborn (`git rev-parse HEAD` fails). */
export async function buildUnbornHeadRepo(): Promise<TempFixture> {
  const dir = await makeTempDir("unborn-head");
  await plumbing.run(["init"], { cwd: dir });
  return withCleanup(dir);
}

/** A real, clean repo with one commit — the base every "clean"/"dirty"/"monorepo" fixture builds on. */
async function initCleanRepo(dir: string): Promise<void> {
  await plumbing.run(["init"], { cwd: dir });
  await plumbing.run(["config", "user.email", "fixture@example.invalid"], { cwd: dir });
  await plumbing.run(["config", "user.name", "Fixture Author"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# fixture repo\n", "utf8");
  await plumbing.run(["add", "README.md"], { cwd: dir });
  await plumbing.run(["commit", "-m", "initial commit"], { cwd: dir });
}

/** Scenario 4 (clean baseline, also reused by the config-drift/upgrade-recovery/uninstall scenarios): a real repo with a real commit, nothing uncommitted. */
export async function buildCleanRepo(): Promise<TempFixture> {
  const dir = await makeTempDir("clean");
  await initCleanRepo(dir);
  return withCleanup(dir);
}

/** Scenario 5: a real repo with an uncommitted (tracked-but-modified) change — `git status --porcelain` is non-empty. */
export async function buildDirtyRepo(): Promise<TempFixture> {
  const dir = await makeTempDir("dirty");
  await initCleanRepo(dir);
  await writeFile(join(dir, "README.md"), "# fixture repo (locally modified)\n", "utf8");
  return withCleanup(dir);
}

/**
 * Scenario 6: a real repo with a nested `packages/<name>/package.json` —
 * `detectMonorepo`'s own documented shape (roadmap/10 §Test plan:
 * "monorepo"). The installer's own artifacts are still rooted at `dir`
 * itself regardless (roadmap/10: "informational only; never changes
 * install behavior") — this fixture exists so the harness can assert
 * `monorepoDetected: true` is reported correctly, not that install
 * behavior changes.
 */
export async function buildMonorepoRepo(): Promise<TempFixture> {
  const dir = await makeTempDir("monorepo");
  await initCleanRepo(dir);
  await mkdir(join(dir, "packages", "widget"), { recursive: true });
  await writeFile(
    join(dir, "packages", "widget", "package.json"),
    `${JSON.stringify({ name: "widget", version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
  await plumbing.run(["add", "packages/widget/package.json"], { cwd: dir });
  await plumbing.run(["commit", "-m", "add widget package"], { cwd: dir });
  return withCleanup(dir);
}

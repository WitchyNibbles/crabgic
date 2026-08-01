/**
 * Hermetic environment for any test that spawns a REAL `git` against a
 * throwaway fixture directory.
 *
 * WHY THIS EXISTS (2026-08-01). A test that does `mkdtempSync()` and then
 * spawns `git init` with `{ cwd: dir }` LOOKS perfectly isolated. It is not.
 * `git` decides which repository it operates on from `GIT_DIR` /
 * `GIT_WORK_TREE` / `GIT_INDEX_FILE` (and friends) BEFORE it ever consults
 * the process's working directory, so an inherited `GIT_DIR` silently
 * redirects the command at whatever repository the PARENT process was
 * pointed at. `cwd` becomes decoration.
 *
 * That inheritance is not hypothetical here. `git` exports `GIT_DIR` into
 * the environment of every hook it runs, and this repository's own
 * `pre-push` hook runs `lint typecheck test build` — the full suite. So on
 * every push the suite executed with `GIT_DIR` aimed at the very repository
 * being pushed. Two unsanitized test files (`cli`'s installer git-repo-state
 * suite and `plugin`'s status-line suite) were enough to produce all three
 * of the following, observed in the wild before this module existed:
 *
 *   1. `git init`   — "Reinitialized existing Git repository". When the hook
 *      fired inside a linked worktree (`GIT_DIR=<main>/.git/worktrees/<n>`)
 *      it additionally wrote `core.bare = true` into the SHARED `.git/config`,
 *      after which `git status` in the main checkout failed outright with
 *      "fatal: this operation must be run in a work tree".
 *   2. `git config user.email` — the real repository's committer identity
 *      overwritten with the test's placeholder.
 *   3. `git commit` — junk commits landed on the branch being pushed,
 *      containing files that lived in an unrelated temp directory.
 *
 * The scrub below is deliberately PREFIX-based rather than a hand-kept
 * denylist. `git rev-parse --local-env-vars` (git 2.43.0) already names
 * fifteen repository-local variables — `GIT_ALTERNATE_OBJECT_DIRECTORIES`,
 * `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`,
 * `GIT_OBJECT_DIRECTORY`, `GIT_DIR`, `GIT_WORK_TREE`,
 * `GIT_IMPLICIT_WORK_TREE`, `GIT_GRAFT_FILE`, `GIT_INDEX_FILE`,
 * `GIT_NO_REPLACE_OBJECTS`, `GIT_REPLACE_REF_BASE`, `GIT_PREFIX`,
 * `GIT_SHALLOW_FILE`, `GIT_COMMON_DIR` — and that list is not even complete
 * for our purposes: `GIT_NAMESPACE`, `GIT_QUARANTINE_PATH`,
 * `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`,
 * `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`, `GIT_DEFAULT_HASH`,
 * `GIT_DEFAULT_REF_FORMAT`, `GIT_TEMPLATE_DIR`, `GIT_*_PATHSPECS` and the
 * `GIT_AUTHOR_*`/`GIT_COMMITTER_*` family all steer behaviour too. Dropping
 * every `GIT_*` name outright is a strict superset of all of them and stays
 * correct when a future git release invents another one, which a denylist
 * would not.
 *
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM=/dev/null` (the same mechanism
 * `git-engine`'s production `CONTROL_CONTEXT_ENV` uses) additionally stops a
 * developer's own `~/.gitconfig` — `core.hooksPath`, a `git-lfs` smudge
 * filter, `init.defaultBranch`, `commit.gpgsign` — from changing what a
 * fixture repo does on one machine versus another.
 *
 * {@link GIT_FIXTURE_IDENTITY_ENV} supplies a committer identity WITHOUT
 * running `git config`, which is what a fixture that only needs "some valid
 * author" should use: it leaves no `git config` invocation to mis-aim in the
 * first place. It is opt-in rather than part of the default overlay on
 * purpose — `GIT_AUTHOR_*`/`GIT_COMMITTER_*` outrank `user.email` from any
 * config file, so forcing them would defeat every fixture whose POINT is a
 * repo-local identity (`git-engine`'s `configureGitIdentity` suite asserts a
 * commit picks up the service email it just wrote to `--local` config).
 *
 * Prefer {@link runFixtureGit}: it cannot be called wrongly. Reach for
 * {@link gitFixtureEnv} only when you need to hand the environment to a
 * spawn you are shaping yourself.
 */

import { execFileSync } from "node:child_process";

/** Committer/author identity every fixture repo commits under. `.invalid` is the RFC 2606 reserved TLD, so it can never resolve to a real mailbox. */
export const GIT_FIXTURE_IDENTITY = Object.freeze({
  name: "Crabgic Fixture",
  email: "fixture@crabgic.invalid",
});

/**
 * The settings layered on after every inherited `GIT_*` name is dropped.
 * Frozen: callers pass per-call overrides as an argument, never by mutating
 * this.
 */
const GIT_FIXTURE_ENV_OVERLAY: Readonly<Record<string, string>> = Object.freeze({
  // Ambient global/system config must not reach a fixture repo (see header).
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_ATTR_NOSYSTEM: "1",
  // A test must never block on a credential/terminal prompt or an editor.
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_PAGER: "cat",
});

/**
 * Author + committer identity as ENVIRONMENT, for fixtures that just need
 * commits to be possible. Pass it as the `env` override
 * (`runFixtureGit(dir, args, { env: GIT_FIXTURE_IDENTITY_ENV })`) instead of
 * running `git config user.email` — the `git config` call was one of the
 * three commands that corrupted the real repository, and this leaves no such
 * call to get mis-aimed.
 *
 * Opt-in, not default: these outrank `user.email` from every config file, so
 * a fixture that is TESTING repo-local identity must be able to leave them
 * unset. See the header.
 */
export const GIT_FIXTURE_IDENTITY_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_AUTHOR_NAME: GIT_FIXTURE_IDENTITY.name,
  GIT_AUTHOR_EMAIL: GIT_FIXTURE_IDENTITY.email,
  GIT_COMMITTER_NAME: GIT_FIXTURE_IDENTITY.name,
  GIT_COMMITTER_EMAIL: GIT_FIXTURE_IDENTITY.email,
});

/**
 * `process.env` with every `GIT_*` name removed and
 * {@link GIT_FIXTURE_ENV_OVERLAY} applied on top — the environment to hand to
 * any `git` spawned against a fixture directory. `overrides` wins last, for
 * the rare test that must set a specific git variable on purpose (e.g. the
 * ambient-config isolation suite, which deliberately supplies its own
 * `GIT_CONFIG_GLOBAL`).
 *
 * Returns a fresh object on every call; nothing here mutates `process.env`.
 */
export function gitFixtureEnv(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.startsWith("GIT_")) continue;
    scrubbed[name] = value;
  }
  return { ...scrubbed, ...GIT_FIXTURE_ENV_OVERLAY, ...overrides };
}

export interface RunFixtureGitOptions {
  /** Extra git variables to set for this one call, applied after the scrub. */
  readonly env?: Readonly<Record<string, string>>;
  /** When true, a non-zero exit returns the captured output instead of throwing. */
  readonly allowFailure?: boolean;
}

/**
 * Runs `git <args>` in `cwd` with the sanitized environment, argv-array only
 * and no shell (same spawn posture as `git-engine`'s production plumbing).
 * Returns stdout. Throws on a non-zero exit unless `allowFailure` is set.
 */
export function runFixtureGit(
  cwd: string,
  args: readonly string[],
  options: RunFixtureGitOptions = {},
): string {
  try {
    return execFileSync("git", [...args], {
      cwd,
      env: gitFixtureEnv(options.env ?? {}),
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (options.allowFailure === true) {
      const stdout = (error as { readonly stdout?: string }).stdout;
      return typeof stdout === "string" ? stdout : "";
    }
    throw error;
  }
}

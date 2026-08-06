/**
 * Per-test-process environment scrub. Runs before any test file in any project
 * that extends the root config.
 *
 * WHY THIS EXISTS, and why it is prevention rather than detection.
 *
 * `git` chooses which repository it operates on from `GIT_DIR` / `GIT_WORK_TREE`
 * / `GIT_INDEX_FILE` and friends BEFORE it consults the process's working
 * directory. So a test that does `mkdtempSync()` and spawns `git` with
 * `{ cwd: fixtureDir }` looks perfectly isolated and is not: an inherited
 * `GIT_DIR` silently re-aims the command at whatever repository the PARENT
 * process was pointed at, and `cwd` becomes decoration.
 *
 * That inheritance is guaranteed here, not hypothetical. `git` exports `GIT_DIR`
 * into the environment of every hook it runs, and the `pre-push` hook in use on
 * this repository runs the full test suite — so on every push, every test
 * process starts with `GIT_DIR` aimed at the repository being pushed.
 *
 * `packages/testkit/src/git-env.ts` documents the three symptoms this produces
 * and offers an opt-in overlay. That overlay is a real control, but it only
 * protects the fixtures that remember to use it, and the class has now fired
 * TWICE: once on 2026-08-01 (which is why that module exists), and once on
 * 2026-08-06, when a test in this very pass spawned `git init` / `git config` /
 * `git commit` / `git update-ref` at a temp directory and instead wrote
 * `core.bare = true` and a `fixture@example.invalid` identity into the shared
 * `.git/config`, left two junk commits on the branch, clobbered
 * `refs/remotes/origin/main`, and broke `git status` in the main checkout with
 * "fatal: this operation must be run in a work tree".
 *
 * An opt-in control that a new test can simply not know about is a control with
 * a hole the size of every future test. Removing the variables from the test
 * process itself closes the hole for tests that have never heard of the overlay,
 * which is the population that keeps causing this.
 *
 * PREFIX SWEEP, not a denylist: `git rev-parse --local-env-vars` already names
 * fifteen repository-local variables, and `GIT_NAMESPACE`, `GIT_QUARANTINE_PATH`,
 * `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_GLOBAL`/`_SYSTEM`,
 * `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` and the
 * `GIT_AUTHOR_*`/`GIT_COMMITTER_*` family steer behaviour too. Dropping every
 * `GIT_*` name is a strict superset that stays correct when a future git release
 * invents another one.
 *
 * SAFE FOR THE TESTS THAT USE THESE VARIABLES: every suite in this repository
 * that exercises `GIT_*` handling ASSIGNS the variable itself inside the test
 * and restores it afterwards (`git-repo-state.test.ts:115-121`,
 * `control-context-isolation.test.ts:98-111`, `merge-preflight.test.ts:291-306`).
 * None reads an ambient value, and each restores by deleting when the original
 * was absent — which, after this scrub, is exactly what it was.
 *
 * KNOWN LIMIT, stated rather than implied: the standalone per-suite configs
 * under `e2e/` do not extend the root config, so their processes are not
 * scrubbed here.
 */
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

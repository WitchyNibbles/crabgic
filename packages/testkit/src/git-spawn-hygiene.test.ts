import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Repo-wide structural guard against the `GIT_DIR` hijack — the same
 * "non-test-absence static check" shape `@crabgic/git-engine`'s
 * `spawn-surface-scan.test.ts` uses for command injection.
 *
 * A test that spawns `git` with `{ cwd: someTempDir }` and nothing else LOOKS
 * isolated and is not: git resolves which repository it operates on from
 * `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` before it consults the working
 * directory, and git exports `GIT_DIR` into every hook it runs — including
 * this repo's own `pre-push` hook, which runs the whole suite. Two such
 * files were enough to re-initialize the real repository, overwrite its
 * committer identity, and land junk commits on the branch being pushed.
 *
 * The point of scanning rather than merely fixing those two: the next person
 * to write `execFileSync("git", ["init"], { cwd: dir })` must be stopped by
 * CI, not by rediscovering the hazard the hard way. Any file that names `git`
 * as the command of a spawn has to textually reference one of the sanctioned
 * scrub mechanisms — `runFixtureGit`/`gitFixtureEnv` (`./git-env.ts`) for
 * tests, or `GIT_LOCATION_ENV_VARS` for the two zero-dependency production
 * sites that cannot import them. This is exactly the strength of the existing
 * `OPTION_TERMINATOR` guard: presence, not proof — enough to make the omission
 * loud.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Matches `git` as the COMMAND argument of any exec/spawn variant
 * (`execFileSync`, `execFileAsync`, `spawnSync`, ...), capturing the
 * subcommand when it is written as a literal first element of the argv array.
 *
 * The capture is `[a-z][a-z-]*` — it must START with a letter. That is
 * load-bearing, not cosmetic: with a leading dash permitted, the FIRST argv
 * element of `["-c", "user.email=…", "commit", …]` or
 * `["--git-dir", d, "config", …]` is captured as `-c` / `--git-dir`, neither
 * of which is in `MUTATING_SUBCOMMANDS`, so a fully hijackable mutating spawn
 * would be classified read-only and exempted. `-c user.name=…` is exactly the
 * config-free identity idiom this module steers people toward, so it is the
 * most likely future shape, not a contrived one. A leading dash now yields
 * `undefined` and falls into the must-scrub branch below.
 *
 * A non-literal argv (`execFileSync("git", args, ...)`) likewise captures
 * `undefined` and is treated as must-scrub — that generic-helper shape is
 * precisely how both original offenders were written.
 */
const GIT_SPAWN =
  /(?:exec|spawn)\w*\s*\(\s*["'`]git["'`]\s*,\s*(?:\[\s*["'`]([a-z][a-z-]*)["'`])?/g;

/**
 * A shell-STRING spawn (`execSync("git init …", { cwd })`) has no argv array
 * to classify, so it can never be proven read-only. Always must-scrub.
 */
const GIT_SHELL_SPAWN = /(?:exec|spawn)\w*\s*\(\s*["'`]git\s/;

/**
 * Subcommands that WRITE. A read-only query (`rev-parse`, `log`, `ls-files`,
 * `archive`, `diff`, `merge-base`, ...) that inherits an ambient `GIT_DIR` is
 * at worst a wrong-repo read — the release tooling under `e2e/` queries the
 * ambient repository on purpose. These, by contrast, corrupt it.
 */
const MUTATING_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "config",
  "fetch",
  "gc",
  "init",
  "merge",
  "mv",
  "prune",
  "pull",
  "push",
  "rebase",
  "remote",
  "reset",
  "restore",
  "revert",
  "rm",
  "sparse-checkout",
  "stash",
  "submodule",
  "switch",
  "tag",
  "update-index",
  "update-ref",
  "worktree",
]);

/** True when a file spawns git with a mutating — or unclassifiable, so assumed mutating — command. */
function spawnsMutatingGit(text: string): boolean {
  if (GIT_SHELL_SPAWN.test(text)) return true;
  for (const match of text.matchAll(GIT_SPAWN)) {
    const subcommand = match[1];
    if (subcommand === undefined || MUTATING_SUBCOMMANDS.has(subcommand)) return true;
  }
  return false;
}

/** Any of the sanctioned ways to scrub git's repository-location variables. */
const SANCTIONED_SCRUB = /runFixtureGit|gitFixtureEnv|GIT_LOCATION_ENV_VARS/;

const SCANNED_ROOTS = ["packages", "e2e", "scripts", "spikes"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "fixtures"]);
const SCANNED_EXTENSIONS = [".ts", ".mts", ".mjs", ".cjs", ".js"];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listFiles(join(dir, entry.name), out);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const ALL_FILES = SCANNED_ROOTS.flatMap((root) => {
  const full = join(REPO_ROOT, root);
  try {
    return statSync(full).isDirectory() ? listFiles(full) : [];
  } catch {
    return [];
  }
}).filter((file) => file !== fileURLToPath(import.meta.url));

describe("git-spawn hygiene (repo-wide GIT_DIR-hijack guard)", () => {
  it("every file that spawns a MUTATING git command references a sanctioned environment scrub", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const text = readFileSync(file, "utf8");
      if (!spawnsMutatingGit(text)) continue;
      if (SANCTIONED_SCRUB.test(text)) continue;
      offenders.push(relative(REPO_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("the scan actually covers this repo (guard against a broken walk)", () => {
    expect(ALL_FILES.length).toBeGreaterThan(200);
  });

  it("the classifier flags every known evasion shape, not just the obvious ones", () => {
    // Adversarial review of PR #50 found the first two of these slipping
    // through: the subcommand capture allowed a leading dash, so the spawn was
    // classified by the FLAG (`-c`, `--git-dir`) rather than by the mutating
    // subcommand behind it. They are pinned here so the regex cannot regress.
    const mustBeFlagged: readonly [string, string][] = [
      [
        "leading -c identity idiom (the shape this module recommends)",
        'execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@x.invalid", "commit", "-m", "x"], { cwd });',
      ],
      [
        "explicit --git-dir before a mutating subcommand",
        'execFileSync("git", ["--git-dir", d, "config", "user.email", "x@y.invalid"], { cwd });',
      ],
      ["--no-pager before a mutating subcommand", 'execFileSync("git", ["--no-pager", "commit"]);'],
      ["shell-string spawn", 'execSync("git init --quiet", { cwd });'],
      ["non-literal argv (the original offenders' shape)", 'execFileSync("git", args, { cwd });'],
      ["plain literal mutating subcommand", 'execFileSync("git", ["init"], { cwd });'],
      ["async variant", 'await execFileAsync("git", ["commit", "-m", "x"], { cwd });'],
      ["spawnSync variant", 'spawnSync("git", ["worktree", "add", p], { cwd });'],
    ];
    const missed = mustBeFlagged
      .filter(([, snippet]) => !spawnsMutatingGit(snippet))
      .map(([label]) => label);
    expect(missed).toEqual([]);

    // ...and the read-only shapes stay exempt, so the scan does not force
    // churn onto release tooling that queries the ambient repo on purpose.
    const mustBeExempt: readonly [string, string][] = [
      ["rev-parse", 'execFileSync("git", ["rev-parse", "HEAD"], { cwd });'],
      ["log", 'await exec("git", ["log", "--format=%s"], { cwd });'],
      ["archive", 'execFileSync("git", ["archive", ref], { cwd });'],
    ];
    const overFlagged = mustBeExempt
      .filter(([, snippet]) => spawnsMutatingGit(snippet))
      .map(([label]) => label);
    expect(overFlagged).toEqual([]);
  });

  it("the guard is not vacuous: mutating git spawns really do exist and really are scrubbed", () => {
    // If this drops to zero the first assertion becomes an empty-set tautology
    // — it would pass just as happily with a broken regex.
    const scrubbed = ALL_FILES.filter((file) => {
      const text = readFileSync(file, "utf8");
      return spawnsMutatingGit(text) && SANCTIONED_SCRUB.test(text);
    }).map((file) => relative(REPO_ROOT, file));
    expect(scrubbed.length).toBeGreaterThanOrEqual(5);
    expect(scrubbed).toContain("packages/cli/src/installer/git-repo-state.test.ts");
    expect(scrubbed).toContain("packages/plugin/src/statusline.test.ts");
  });
});

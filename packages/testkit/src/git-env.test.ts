import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GIT_FIXTURE_IDENTITY,
  GIT_FIXTURE_IDENTITY_ENV,
  gitFixtureEnv,
  runFixtureGit,
} from "./git-env.js";

/**
 * Regression guard for the defect `./git-env.ts` exists to prevent: a test
 * that spawns `git` against a `mkdtemp` directory with `{ cwd }` alone is
 * steered by an inherited `GIT_DIR` instead, because git resolves the
 * repository from the environment BEFORE it consults the working directory.
 * Git exports `GIT_DIR` to every hook it runs and this repo's `pre-push`
 * hook runs the whole suite, so "inherited `GIT_DIR`" is the normal case on
 * every push, not an exotic one.
 *
 * The containment test below poisons `GIT_DIR` exactly the way the hook does,
 * runs the full `init` / `config` / `add` / `commit` sequence through
 * `runFixtureGit`, and asserts the poisoned repository is byte-identical
 * afterwards. Its paired CONTROL test runs the same sequence with a plain
 * inherited environment and asserts the poisoned repository IS corrupted —
 * without that pairing the containment assertion could pass vacuously (e.g.
 * if `git` had stopped honouring `GIT_DIR` at all) and would silently stop
 * guarding anything.
 */

const dirs: string[] = [];
function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Every observable thing the three hijack effects (re-init, identity overwrite, junk commit) would change. */
interface RepoSnapshot {
  readonly head: string;
  readonly commitCount: string;
  readonly log: string;
  readonly configFile: string;
}

/** Reads `gitDir`'s state through an explicit `--git-dir`, so the probe itself is never steered by ambient env. */
function snapshot(gitDir: string): RepoSnapshot {
  const probe = (args: readonly string[]): string =>
    execFileSync("git", ["--git-dir", gitDir, ...args], {
      encoding: "utf8",
      env: gitFixtureEnv(),
    }).trim();
  return {
    head: probe(["rev-parse", "HEAD"]),
    commitCount: probe(["rev-list", "--count", "HEAD"]),
    log: probe(["log", "--format=%H %an <%ae> %s"]),
    configFile: readFileSync(join(gitDir, "config"), "utf8"),
  };
}

/** A real one-commit repo standing in for "the repository being pushed". */
function buildVictimRepo(): { readonly dir: string; readonly gitDir: string } {
  const dir = makeTmpDir("crabgic-git-env-victim-");
  const git = (args: readonly string[]): string =>
    runFixtureGit(dir, args, { env: GIT_FIXTURE_IDENTITY_ENV });
  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "real.txt"), "real work\n", "utf8");
  git(["add", "real.txt"]);
  git(["commit", "-q", "-m", "legitimate commit", "--no-verify"]);
  return { dir, gitDir: join(dir, ".git") };
}

/** Runs a callback with `GIT_DIR` poisoned exactly as a git hook would set it, always restoring it. */
function withPoisonedGitDir(gitDir: string, body: () => void): void {
  const original = process.env["GIT_DIR"];
  process.env["GIT_DIR"] = gitDir;
  try {
    body();
  } finally {
    if (original === undefined) delete process.env["GIT_DIR"];
    else process.env["GIT_DIR"] = original;
  }
}

/** The exact shape the two defective suites had: init, set an identity, write a file, commit — all aimed at `dir` by `cwd` alone. */
function fixtureSetupSequence(dir: string, run: (args: readonly string[]) => void): void {
  run(["init"]);
  run(["config", "user.email", "test@example.invalid"]);
  run(["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.txt"), "a", "utf8");
  run(["add", "a.txt"]);
  run(["commit", "-m", "init", "--no-verify"]);
}

describe("gitFixtureEnv", () => {
  it("drops every inherited GIT_* variable that could redirect git away from cwd", () => {
    const poison = {
      GIT_DIR: "/poison/.git",
      GIT_WORK_TREE: "/poison",
      GIT_INDEX_FILE: "/poison/.git/index",
      GIT_OBJECT_DIRECTORY: "/poison/.git/objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/poison/alt",
      GIT_COMMON_DIR: "/poison/.git",
      GIT_NAMESPACE: "poison",
      GIT_PREFIX: "sub/",
      GIT_QUARANTINE_PATH: "/poison/quarantine",
      GIT_CEILING_DIRECTORIES: "/poison",
      GIT_GRAFT_FILE: "/poison/grafts",
      GIT_SHALLOW_FILE: "/poison/shallow",
      GIT_REPLACE_REF_BASE: "refs/poison",
      GIT_IMPLICIT_WORK_TREE: "1",
      GIT_CONFIG: "/poison/config",
      GIT_CONFIG_PARAMETERS: "'core.bare=true'",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.bare",
      GIT_CONFIG_VALUE_0: "true",
      GIT_DEFAULT_HASH: "sha256",
      GIT_TEMPLATE_DIR: "/poison/templates",
      GIT_LITERAL_PATHSPECS: "1",
    };
    const saved = new Map(Object.keys(poison).map((k) => [k, process.env[k]]));
    Object.assign(process.env, poison);
    try {
      const env = gitFixtureEnv();
      for (const name of Object.keys(poison)) {
        expect(env[name], `${name} must not survive the scrub`).not.toBe(
          poison[name as keyof typeof poison],
        );
      }
      // Nothing repository-locating survives at all; only the overlay's own
      // GIT_* settings are present.
      expect(env["GIT_DIR"]).toBeUndefined();
      expect(env["GIT_WORK_TREE"]).toBeUndefined();
      expect(env["GIT_CONFIG_PARAMETERS"]).toBeUndefined();
      expect(env["GIT_CONFIG_COUNT"]).toBeUndefined();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("neutralizes ambient global/system config and never blocks on a prompt", () => {
    const env = gitFixtureEnv();
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/dev/null");
    expect(env["GIT_CONFIG_SYSTEM"]).toBe("/dev/null");
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
  });

  it("leaves the committer identity UNSET by default, so a repo-local identity still decides", () => {
    // Opt-in on purpose: GIT_AUTHOR_*/GIT_COMMITTER_* outrank every config
    // file, so forcing them would defeat `configureGitIdentity`'s own suite.
    const env = gitFixtureEnv();
    expect(env["GIT_AUTHOR_EMAIL"]).toBeUndefined();
    expect(env["GIT_COMMITTER_EMAIL"]).toBeUndefined();
    const withIdentity = gitFixtureEnv(GIT_FIXTURE_IDENTITY_ENV);
    expect(withIdentity["GIT_AUTHOR_EMAIL"]).toBe(GIT_FIXTURE_IDENTITY.email);
    expect(withIdentity["GIT_COMMITTER_EMAIL"]).toBe(GIT_FIXTURE_IDENTITY.email);
  });

  it("keeps the non-git environment, so the git binary is still resolvable", () => {
    expect(gitFixtureEnv()["PATH"]).toBe(process.env["PATH"]);
  });

  it("lets an explicit per-call override win over the scrub", () => {
    const env = gitFixtureEnv({ GIT_CONFIG_GLOBAL: "/tmp/ambient-fixture" });
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/tmp/ambient-fixture");
  });

  it("returns a fresh object and never mutates process.env", () => {
    const before = { ...process.env };
    const first = gitFixtureEnv();
    first["PATH"] = "mutated";
    expect(gitFixtureEnv()["PATH"]).toBe(before["PATH"]);
    expect(process.env["PATH"]).toBe(before["PATH"]);
  });
});

describe("runFixtureGit — GIT_DIR hijack containment", () => {
  it("leaves a poisoned GIT_DIR repository completely untouched (head, commit count, log, config)", () => {
    const victim = buildVictimRepo();
    const unrelated = makeTmpDir("crabgic-git-env-unrelated-");
    const before = snapshot(victim.gitDir);

    withPoisonedGitDir(victim.gitDir, () => {
      fixtureSetupSequence(unrelated, (args) => {
        runFixtureGit(unrelated, args, { env: GIT_FIXTURE_IDENTITY_ENV });
      });
    });

    expect(snapshot(victim.gitDir)).toEqual(before);
    // ...and the work genuinely landed where `cwd` said it should.
    const head = runFixtureGit(unrelated, ["log", "--format=%s"]).trim();
    expect(head).toBe("init");
  });

  it("CONTROL: the same sequence on an inherited environment DOES corrupt the poisoned repository", () => {
    const victim = buildVictimRepo();
    const unrelated = makeTmpDir("crabgic-git-env-control-");
    const before = snapshot(victim.gitDir);

    withPoisonedGitDir(victim.gitDir, () => {
      fixtureSetupSequence(unrelated, (args) => {
        execFileSync("git", [...args], { cwd: unrelated, encoding: "utf8", stdio: "ignore" });
      });
    });

    const after = snapshot(victim.gitDir);
    // All three observed effects, asserted individually so the control test
    // documents precisely what the guard above is guarding against.
    expect(after.head, "junk commit landed on the victim's branch").not.toBe(before.head);
    expect(after.commitCount, "victim gained a commit").not.toBe(before.commitCount);
    expect(after.log, "junk commit is authored by the test placeholder").toContain(
      "Test <test@example.invalid>",
    );
    expect(after.configFile, "victim's committer identity overwritten").toContain(
      "test@example.invalid",
    );
  });
});

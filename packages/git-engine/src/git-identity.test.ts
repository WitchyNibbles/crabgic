import { afterEach, describe, expect, it } from "vitest";
import {
  configureGitIdentity,
  ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME,
} from "./git-identity.js";
import { createGitPlumbing, createNodeGitSpawn } from "./plumbing.js";
import {
  buildBasicFixtureRepo,
  fixtureGit,
  removeDirTree,
  writeFixtureFile,
} from "./test-support/fixture-repo.js";

/**
 * WI8 — roadmap/07-git-control-repo-worktrees.md work item 8: "Failing-
 * test-first: a commit made immediately after worktree creation, with no
 * explicit identity call from the caller, must already carry the
 * configured neutral identity." This file tests `configureGitIdentity`
 * directly, against a real repo, with NO global git identity configured
 * (see `test-support/fixture-repo.ts`'s own doc comment) — so if identity
 * isn't genuinely set, the subsequent commit fails outright (a real,
 * observable failure, not a silent default).
 */

const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) removeDirTree(dirs.pop()!);
});

describe("configureGitIdentity (WI8)", () => {
  it("sets user.name to the fixed neutral name and user.email to the configured service email, locally (never global)", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    // Strip the fixture's own local identity so a genuine identity-missing
    // commit would fail without this function's own configuration.
    fixtureGit(dir, ["config", "--unset", "user.name"]);
    fixtureGit(dir, ["config", "--unset", "user.email"]);

    await configureGitIdentity(plumbing, dir, "svc-eo@example.invalid");

    const name = await plumbing.run(["config", "--local", "--get", "user.name"], { cwd: dir });
    const email = await plumbing.run(["config", "--local", "--get", "user.email"], { cwd: dir });
    expect(name.stdout.trim()).toBe(ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME);
    expect(email.stdout.trim()).toBe("svc-eo@example.invalid");
  });

  it("a commit made immediately afterward carries the configured identity, with no further identity call", async () => {
    const { dir } = buildBasicFixtureRepo();
    dirs.push(dir);
    fixtureGit(dir, ["config", "--unset", "user.name"]);
    fixtureGit(dir, ["config", "--unset", "user.email"]);

    await configureGitIdentity(plumbing, dir, "svc-eo@example.invalid");

    writeFixtureFile(dir, "post-identity.txt", "x\n");
    fixtureGit(dir, ["add", "-A"]);
    fixtureGit(dir, ["commit", "-q", "-m", "commit right after identity config", "--no-verify"]);

    const authorName = fixtureGit(dir, ["log", "-1", "--format=%an"]).trim();
    const authorEmail = fixtureGit(dir, ["log", "-1", "--format=%ae"]).trim();
    expect(authorName).toBe(ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME);
    expect(authorEmail).toBe("svc-eo@example.invalid");
  });
});

/**
 * Repo-state scenarios — roadmap/23-release-hardening.md work item 3 /
 * roadmap/10-plugin-and-installer.md's own installation-matrix list:
 * "empty dir, invalid `.git`, unborn HEAD, dirty repo, monorepo." Every
 * scenario runs the REAL `install` backend (`parseCommand`/`dispatchCommand`
 * against a real, throwaway temp repo) and asserts the documented,
 * per-`GitRepoState` outcome.
 */
import type { JournalStore } from "@crabgic/journal";
import { randomUUID } from "node:crypto";
import { buildCliDependencies, runCliJson } from "../cli-driver.js";
import { emitScenarioEvidence } from "../evidence.js";
import {
  buildDirtyRepo,
  buildEmptyDir,
  buildInvalidGitDir,
  buildMonorepoRepo,
  buildUnbornHeadRepo,
} from "../fixtures.js";
import { requirePassed } from "../scenario-support.js";
import type { InstallJsonResult, ScenarioOutcome } from "../scenario-types.js";
import { resolveHeadObjectId, syntheticObjectId } from "./object-id.js";

async function recordAndReturn(
  journal: JournalStore,
  name: string,
  passed: boolean,
  detail: string,
  objectId: string,
): Promise<ScenarioOutcome> {
  await emitScenarioEvidence(journal, {
    changeSetId: randomUUID(),
    command: name,
    exitStatus: passed ? 0 : 1,
    objectId,
    detail,
  });
  requirePassed(passed, name, detail);
  return { name, passed, detail, objectId };
}

/**
 * Empty dir: default (declined) `confirmGitInit` must abort WITHOUT ever
 * running `git init` or writing any artifact (roadmap/10 §In scope,
 * "Non-Git projects: `git init` only after explicit approval"); a SECOND
 * fresh empty dir with an APPROVED `confirmGitInit` must perform the init
 * and complete a real install — both branches of the one approval gate,
 * asserted against real installs.
 */
export async function runEmptyDirScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const declinedFixture = await buildEmptyDir();
  const approvedFixture = await buildEmptyDir();
  try {
    const declinedDeps = buildCliDependencies({ targetDir: declinedFixture.dir, journal });
    const { result: declined } = await runCliJson<InstallJsonResult>(["install"], declinedDeps);

    const approvedDeps = buildCliDependencies({
      targetDir: approvedFixture.dir,
      journal,
      confirmGitInit: () => Promise.resolve(true),
    });
    const { result: approved } = await runCliJson<InstallJsonResult>(["install"], approvedDeps);

    const passed =
      declined.status === "aborted-git-init-declined" &&
      declined.repoState === "not-a-repo" &&
      declined.gitInitPerformed === false &&
      declined.diff.length === 0 &&
      approved.status === "installed" &&
      approved.repoState === "not-a-repo" &&
      approved.gitInitPerformed === true &&
      approved.diff.length > 0;

    return await recordAndReturn(
      journal,
      "installation-matrix/empty-dir",
      passed,
      `declined: status=${declined.status} gitInitPerformed=${String(declined.gitInitPerformed)} diffLen=${String(declined.diff.length)}; ` +
        `approved: status=${approved.status} gitInitPerformed=${String(approved.gitInitPerformed)} diffLen=${String(approved.diff.length)}`,
      syntheticObjectId("installation-matrix/empty-dir"),
    );
  } finally {
    await declinedFixture.cleanup();
    await approvedFixture.cleanup();
  }
}

/** Invalid `.git`: install must complete (repoState reported "invalid-git", never treated as "not-a-repo") and never attempt `git init`. */
export async function runInvalidGitScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const fixture = await buildInvalidGitDir();
  try {
    const deps = buildCliDependencies({
      targetDir: fixture.dir,
      journal,
      confirmGitInit: () =>
        Promise.reject(
          new Error(
            "invalid-git scenario: confirmGitInit must never be invoked for this repoState",
          ),
        ),
    });
    const { result } = await runCliJson<InstallJsonResult>(["install"], deps);
    const passed =
      result.status === "installed" &&
      result.repoState === "invalid-git" &&
      result.gitInitPerformed === false;
    return await recordAndReturn(
      journal,
      "installation-matrix/invalid-git",
      passed,
      `status=${result.status} repoState=${result.repoState} gitInitPerformed=${String(result.gitInitPerformed)}`,
      syntheticObjectId("installation-matrix/invalid-git"),
    );
  } finally {
    await fixture.cleanup();
  }
}

/** Unborn HEAD: a real `git init`-ed repo with zero commits — install must complete and report `repoState: "unborn-head"`. */
export async function runUnbornHeadScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const fixture = await buildUnbornHeadRepo();
  try {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal });
    const { result } = await runCliJson<InstallJsonResult>(["install"], deps);
    const passed =
      result.status === "installed" &&
      result.repoState === "unborn-head" &&
      result.gitInitPerformed === false;
    return await recordAndReturn(
      journal,
      "installation-matrix/unborn-head",
      passed,
      `status=${result.status} repoState=${result.repoState}`,
      syntheticObjectId("installation-matrix/unborn-head"),
    );
  } finally {
    await fixture.cleanup();
  }
}

/** Dirty repo: a real repo with an uncommitted change — install must complete, report `repoState: "dirty"`, and never touch the user's own uncommitted edit (only `.claude/`/`CLAUDE.md`/`.mcp.json` are ever written). */
export async function runDirtyRepoScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const fixture = await buildDirtyRepo();
  try {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal });
    const { result } = await runCliJson<InstallJsonResult>(["install"], deps);
    const objectId = await resolveHeadObjectId(fixture.dir);
    const passed = result.status === "installed" && result.repoState === "dirty";
    return await recordAndReturn(
      journal,
      "installation-matrix/dirty-repo",
      passed,
      `status=${result.status} repoState=${result.repoState}`,
      objectId,
    );
  } finally {
    await fixture.cleanup();
  }
}

/** Monorepo: a real repo with a nested `packages/<name>/package.json` — install must report `monorepoDetected: true` and still root every artifact at the repo's own top level. */
export async function runMonorepoScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const fixture = await buildMonorepoRepo();
  try {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal });
    const { result } = await runCliJson<InstallJsonResult>(["install"], deps);
    const objectId = await resolveHeadObjectId(fixture.dir);
    const passed =
      result.status === "installed" &&
      result.repoState === "clean" &&
      result.monorepoDetected === true &&
      result.diff.every((d) => !d.relPath.startsWith("packages/"));
    return await recordAndReturn(
      journal,
      "installation-matrix/monorepo",
      passed,
      `status=${result.status} repoState=${result.repoState} monorepoDetected=${String(result.monorepoDetected)}`,
      objectId,
    );
  } finally {
    await fixture.cleanup();
  }
}

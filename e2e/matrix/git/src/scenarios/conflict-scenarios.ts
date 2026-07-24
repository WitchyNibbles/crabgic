/**
 * Conflict scenarios — roadmap/23-release-hardening.md work item 5:
 * "conflicts" (part of the git-invariance + neutral-rendering matrix
 * against 07/08). Drives the REAL `preflightMerge` (`@eo/git-engine`,
 * wraps `git merge-tree --write-tree`) against real, on-disk fixture repos
 * with real diverging branches — no mocked git, no hand-built
 * `PreflightResult`.
 */
import type { JournalStore } from "@eo/journal";
import { preflightMerge } from "@eo/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import { buildBasicFixtureRepo, commitAll, plumbing, writeFixtureFile } from "../fixtures.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";

export async function runCleanMergeScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const repo = await buildBasicFixtureRepo();
  try {
    await plumbing.run(["checkout", "-q", "-b", "candidate"], { cwd: repo.dir });
    await writeFixtureFile(repo.dir, "candidate-only.txt", "candidate change\n");
    await commitAll(repo.dir, "candidate change (disjoint file)");
    await plumbing.run(["checkout", "-q", "main"], { cwd: repo.dir });
    await writeFixtureFile(repo.dir, "src/a.txt", "alpha\nmain-side change\n");
    const integrationTipObjectId = await commitAll(repo.dir, "main-side change");

    const result = await preflightMerge(plumbing, {
      repoDir: repo.dir,
      candidateRef: "candidate",
      integrationTipObjectId,
      changeSetId: CHANGE_SET_ID,
    });

    const passed = result.ok === true && /^[0-9a-f]{40,64}$/.test(result.ok ? result.treeId : "");
    const detail = result.ok
      ? `clean merge: treeId=${result.treeId}`
      : `expected a clean merge, got ${String(result.conflicts.length)} conflict(s)`;

    await emitScenarioEvidence(journal, {
      changeSetId: CHANGE_SET_ID,
      command: "preflightMerge (clean, disjoint files)",
      exitStatus: exitStatusFor(passed),
      objectId: integrationTipObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/clean-merge", detail);
    return { name: "git-matrix/clean-merge", passed, detail, objectId: integrationTipObjectId };
  } finally {
    await repo.cleanup();
  }
}

export async function runConflictScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const repo = await buildBasicFixtureRepo();
  try {
    await plumbing.run(["checkout", "-q", "-b", "candidate"], { cwd: repo.dir });
    await writeFixtureFile(repo.dir, "src/a.txt", "alpha\ncandidate-change\n");
    await commitAll(repo.dir, "candidate edits src/a.txt");
    await plumbing.run(["checkout", "-q", "main"], { cwd: repo.dir });
    await writeFixtureFile(repo.dir, "src/a.txt", "alpha\nmain-change\n");
    const integrationTipObjectId = await commitAll(repo.dir, "main edits src/a.txt too");

    const result = await preflightMerge(plumbing, {
      repoDir: repo.dir,
      candidateRef: "candidate",
      integrationTipObjectId,
      changeSetId: CHANGE_SET_ID,
    });

    const passed =
      result.ok === false &&
      result.conflicts.length === 1 &&
      result.conflicts[0]?.ownedPaths.includes("src/a.txt") === true &&
      result.conflicts[0]?.changeSetId === CHANGE_SET_ID;
    const detail = result.ok
      ? "expected a conflict on src/a.txt, got a clean merge"
      : `${String(result.conflicts.length)} resolution WorkUnit(s): ${result.conflicts.map((c) => c.ownedPaths.join(",")).join("; ")}`;

    await emitScenarioEvidence(journal, {
      changeSetId: CHANGE_SET_ID,
      command: "preflightMerge (intersecting hunk)",
      exitStatus: exitStatusFor(passed),
      objectId: integrationTipObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/conflict", detail);
    return { name: "git-matrix/conflict", passed, detail, objectId: integrationTipObjectId };
  } finally {
    await repo.cleanup();
  }
}

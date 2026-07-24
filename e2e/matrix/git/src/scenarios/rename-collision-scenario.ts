/**
 * Rename-collision scenario — roadmap/23-release-hardening.md work item 5:
 * "renames." Drives REAL `git diff --find-renames` (via `@eo/git-engine`'s
 * `detectRenamesFromWorktree`) against two real, on-disk diverging
 * branches — one renames a tracked file, the other edits that SAME file's
 * original path — then feeds both real `DetectedChanges` straight into the
 * REAL rename-aware `analyzeOverlap`, proving the moved-in-one/edited-in-
 * other pair is flagged as a collision end-to-end (07's own exit
 * criterion, exercised here against real git history rather than a
 * synthetic `PlannedWriteSet`).
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JournalStore } from "@eo/journal";
import { analyzeOverlap, detectRenamesFromWorktree, type PlannedWriteSet } from "@eo/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import { buildBasicFixtureRepo, commitAll, plumbing } from "../fixtures.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

export async function runRenameCollisionScenario(journal: JournalStore): Promise<ScenarioOutcome> {
  const repo = await buildBasicFixtureRepo();
  try {
    const baseRef = repo.headObjectId;

    // Unit A: renames src/a.txt -> src/renamed.txt.
    await plumbing.run(["checkout", "-q", "-b", "unit-a"], { cwd: repo.dir });
    await plumbing.run(["mv", "src/a.txt", "src/renamed.txt"], { cwd: repo.dir });
    await commitAll(repo.dir, "unit A: rename src/a.txt");
    const unitAChanges = await detectRenamesFromWorktree(plumbing, repo.dir, baseRef, "unit-a");

    // Unit B: edits the ORIGINAL src/a.txt content, diverging independently from base.
    await plumbing.run(["checkout", "-q", "-b", "unit-b", baseRef], { cwd: repo.dir });
    await writeFile(join(repo.dir, "src/a.txt"), "alpha\nunit-b edit\n", "utf8");
    await commitAll(repo.dir, "unit B: edit src/a.txt");
    const unitBChanges = await detectRenamesFromWorktree(plumbing, repo.dir, baseRef, "unit-b");

    const setA: PlannedWriteSet = {
      unitId: "unit-a",
      paths: unitAChanges.paths,
      renames: unitAChanges.renames,
    };
    const setB: PlannedWriteSet = { unitId: "unit-b", paths: unitBChanges.paths };

    const verdicts = analyzeOverlap([setA, setB]);
    const verdict = verdicts.find(
      (v) =>
        (v.unitA === "unit-a" && v.unitB === "unit-b") ||
        (v.unitA === "unit-b" && v.unitB === "unit-a"),
    );

    const passed =
      verdict !== undefined &&
      verdict.collides === true &&
      verdict.collidingPaths.includes("src/a.txt");
    const detail = `unitAChanges=${JSON.stringify(unitAChanges)}; unitBChanges=${JSON.stringify(unitBChanges)}; verdict=${JSON.stringify(verdict)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "detectRenamesFromWorktree + analyzeOverlap (moved-in-one/edited-in-other)",
      exitStatus: exitStatusFor(passed),
      objectId: baseRef,
      detail,
    });
    requirePassed(passed, "git-matrix/rename-collision", detail);
    return { name: "git-matrix/rename-collision", passed, detail, objectId: baseRef };
  } finally {
    await repo.cleanup();
  }
}

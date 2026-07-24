/**
 * Uninstall-preserving-user-edits scenario — roadmap/10-plugin-and-
 * installer.md work item 6's own failing-first framing: "uninstall over a
 * file with a user edit deletes the user's edit under the stub." Installs
 * for real, drifts an owned "merged" artifact with a real out-of-band user
 * edit, uninstalls for real, and asserts BOTH the reported outcome
 * (`assertUserEditsPreserved`, `../user-edit-assertion.ts`) AND the actual
 * on-disk byte content still carries the user's edit afterward — the
 * reported action alone is not proof; the file itself must still say what
 * the user wrote.
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JournalStore } from "@eo/journal";
import { buildCliDependencies, runCliJson } from "../cli-driver.js";
import { emitScenarioEvidence } from "../evidence.js";
import { buildCleanRepo } from "../fixtures.js";
import { findOutcomeAction, requirePassed, requireStatus } from "../scenario-support.js";
import type { InstallJsonResult, ScenarioOutcome, UninstallJsonResult } from "../scenario-types.js";
import { assertUserEditsPreserved } from "../user-edit-assertion.js";
import { resolveHeadObjectId } from "./object-id.js";

const USER_EDIT_MARKER = "## My team's own local note (never touch this)";

export async function runUninstallPreservingEditsScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const fixture = await buildCleanRepo();
  try {
    const deps = buildCliDependencies({ targetDir: fixture.dir, journal });
    const { result: installResult } = await runCliJson<InstallJsonResult>(["install"], deps);
    requireStatus(installResult.status, "installed", "uninstall-preserving-edits");

    const claudeMdPath = join(fixture.dir, "CLAUDE.md");
    const installedContent = await readFile(claudeMdPath, "utf8");
    const withUserEdit = `${installedContent}\n${USER_EDIT_MARKER}\n`;
    await writeFile(claudeMdPath, withUserEdit, "utf8");

    const { result: uninstallResult } = await runCliJson<UninstallJsonResult>(["uninstall"], deps);

    // Real end-to-end proof #1: the reported outcome shape — the same
    // pure assertion whose own fail-first RED/GREEN proof lives in
    // `test/user-edit-assertion.test.ts`.
    assertUserEditsPreserved(uninstallResult.outcomes, ["CLAUDE.md"]);

    // Real end-to-end proof #2: the actual byte content on disk still
    // carries the user's edit — the reported action alone is not proof.
    const afterUninstallContent = await readFile(claudeMdPath, "utf8");
    const contentPreserved = afterUninstallContent.includes(USER_EDIT_MARKER);

    const objectId = await resolveHeadObjectId(fixture.dir);
    const claudeMdAction = findOutcomeAction(uninstallResult.outcomes, "CLAUDE.md");
    const detail = `CLAUDE.md uninstall action="${claudeMdAction}"; user-edit marker still present on disk: ${String(contentPreserved)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "uninstall --json (preserving user edits)",
      exitStatus: contentPreserved ? 0 : 1,
      objectId,
      detail,
    });
    requirePassed(contentPreserved, "installation-matrix/uninstall-preserving-edits", detail);
    return {
      name: "installation-matrix/uninstall-preserving-edits",
      passed: contentPreserved,
      detail,
      objectId,
    };
  } finally {
    await fixture.cleanup();
  }
}

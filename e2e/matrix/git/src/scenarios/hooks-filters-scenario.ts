/**
 * Hooks/filters-neutralization scenario — roadmap/23-release-hardening.md
 * work item 5: "filters, hooks." A REAL, executable `pre-commit` hook
 * script is installed that writes a marker file when it runs; the scenario
 * first proves the hook mechanism genuinely fires (not a vacuous test),
 * then proves `neutralizeHooksPath` (`@eo/git-engine`) genuinely stops it
 * from firing, AND that `validateRepository` correctly reports
 * `hooksPathNeutralized: true` afterward.
 *
 * REPO-LOCAL `core.hooksPath` IS SET EXPLICITLY before the "before
 * neutralization" commit (confirmed necessary against this project's own
 * dev host: a host-level `~/.gitconfig` `core.hooksPath` override — the
 * exact ambient-config class `@eo/git-engine`'s own `CONTROL_CONTEXT_ENV`
 * exists to neutralize for CONTROL-context operations — otherwise silently
 * wins over an unconfigured repo-local hooks dir and the fixture's own
 * `.git/hooks/pre-commit` script never runs at all, regardless of
 * `neutralizeHooksPath`). Setting it explicitly here restores the
 * ordinary, default-hooks-active starting state this scenario needs to
 * prove neutralization AGAINST, without weakening what `neutralizeHooksPath`
 * itself is asserted to do (it still sets the SAME key to `""` afterward).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JournalStore } from "@eo/journal";
import { neutralizeHooksPath, validateRepository } from "@eo/git-engine";
import { emitScenarioEvidence } from "../evidence.js";
import {
  buildBasicFixtureRepo,
  commitAllHonoringHooks,
  plumbing,
  writeFixtureFile,
} from "../fixtures.js";
import { exitStatusFor, requirePassed, type ScenarioOutcome } from "../scenario-types.js";

function markerPath(repoDir: string): string {
  return join(repoDir, ".hook-fired-marker");
}

async function installPreCommitHook(repoDir: string): Promise<void> {
  const hooksDir = join(repoDir, ".git", "hooks");
  // Repo-local, absolute — wins over any ambient global `core.hooksPath`
  // (see file-level doc comment), matching the default "hooks live under
  // `.git/hooks`" shape `neutralizeHooksPath` is asserted to disable.
  await plumbing.run(["config", "core.hooksPath", hooksDir], { cwd: repoDir });
  const hookPath = join(hooksDir, "pre-commit");
  await writeFile(hookPath, `#!/bin/sh\ntouch "${markerPath(repoDir)}"\n`, "utf8");
  await chmod(hookPath, 0o755);
}

export async function runHooksNeutralizationScenario(
  journal: JournalStore,
): Promise<ScenarioOutcome> {
  const repo = await buildBasicFixtureRepo();
  try {
    await installPreCommitHook(repo.dir);

    // Sanity check first: prove the hook mechanism itself genuinely fires
    // in this environment BEFORE trusting the neutralization assertion
    // below — a neutralization "pass" against a hook that was never going
    // to fire anyway would be vacuous.
    await writeFixtureFile(repo.dir, "src/b.txt", "beta\n");
    await commitAllHonoringHooks(repo.dir, "commit with hooks honored (sanity check)");
    const hookFiredBeforeNeutralization = existsSync(markerPath(repo.dir));
    await rm(markerPath(repo.dir), { force: true });

    // Now neutralize, and prove the SAME hook script no longer fires.
    await neutralizeHooksPath(plumbing, repo.dir);
    await writeFixtureFile(repo.dir, "src/c.txt", "gamma\n");
    const headObjectId = await commitAllHonoringHooks(
      repo.dir,
      "commit after hooksPath neutralization",
    );
    const hookFiredAfterNeutralization = existsSync(markerPath(repo.dir));

    const report = await validateRepository(plumbing, repo.dir);

    const passed =
      hookFiredBeforeNeutralization === true &&
      hookFiredAfterNeutralization === false &&
      report.hooksPathNeutralized === true;
    const detail =
      `hookFiredBeforeNeutralization=${String(hookFiredBeforeNeutralization)}; ` +
      `hookFiredAfterNeutralization=${String(hookFiredAfterNeutralization)}; ` +
      `hooksPathNeutralized=${String(report.hooksPathNeutralized)}`;

    await emitScenarioEvidence(journal, {
      changeSetId: randomUUID(),
      command: "neutralizeHooksPath + validateRepository (hooks/filters)",
      exitStatus: exitStatusFor(passed),
      objectId: headObjectId,
      detail,
    });
    requirePassed(passed, "git-matrix/hooks-filters", detail);
    return { name: "git-matrix/hooks-filters", passed, detail, objectId: headObjectId };
  } finally {
    await repo.cleanup();
  }
}

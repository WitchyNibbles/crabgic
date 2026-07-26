/**
 * The 9-scenario installation matrix, aggregated — roadmap/10-plugin-and-
 * installer.md's own list, verbatim: "empty dir, invalid `.git`, unborn
 * HEAD, dirty repo, monorepo, config drift, interrupted upgrade, rollback,
 * uninstall preserving user edits."
 */
import type { JournalStore } from "@crabgic/journal";
import { runConfigDriftScenario } from "./config-drift-scenario.js";
import {
  runDirtyRepoScenario,
  runEmptyDirScenario,
  runInvalidGitScenario,
  runMonorepoScenario,
  runUnbornHeadScenario,
} from "./repo-state-scenarios.js";
import { runUninstallPreservingEditsScenario } from "./uninstall-preserving-edits-scenario.js";
import {
  runInterruptedUpgradeScenario,
  runRollbackScenario,
} from "./upgrade-recovery-scenarios.js";
import type { ScenarioOutcome } from "../scenario-types.js";

export type ScenarioRunner = (journal: JournalStore) => Promise<ScenarioOutcome>;

/** Every scenario runner, in the roadmap's own listed order. */
export const INSTALLATION_MATRIX_SCENARIOS: readonly ScenarioRunner[] = [
  runEmptyDirScenario,
  runInvalidGitScenario,
  runUnbornHeadScenario,
  runDirtyRepoScenario,
  runMonorepoScenario,
  runConfigDriftScenario,
  runInterruptedUpgradeScenario,
  runRollbackScenario,
  runUninstallPreservingEditsScenario,
];

export {
  runConfigDriftScenario,
  runDirtyRepoScenario,
  runEmptyDirScenario,
  runInterruptedUpgradeScenario,
  runInvalidGitScenario,
  runMonorepoScenario,
  runRollbackScenario,
  runUnbornHeadScenario,
  runUninstallPreservingEditsScenario,
};

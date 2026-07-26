/**
 * The git-invariance + neutral-rendering matrix, aggregated —
 * roadmap/23-release-hardening.md work item 5's own list: "checkout
 * invariance; conflicts, renames, SHA-256 repos, submodules, LFS, filters,
 * hooks; branch/commit goldens incl. attribution-leak fixtures."
 */
import type { JournalStore } from "@crabgic/journal";
import {
  runAttributionLeakBlockedScenario,
  runCleanBranchCommitGoldenScenario,
} from "./branch-commit-golden-scenarios.js";
import { runCheckoutInvarianceScenario } from "./checkout-invariance-scenario.js";
import { runCleanMergeScenario, runConflictScenario } from "./conflict-scenarios.js";
import { runHooksNeutralizationScenario } from "./hooks-filters-scenario.js";
import {
  runCleanPublishScenario,
  runPublishAttributionLeakScenario,
} from "./publish-attribution-leak-scenario.js";
import { runRenameCollisionScenario } from "./rename-collision-scenario.js";
import {
  runLfsPointerScenario,
  runSha256RepoScenario,
  runSubmoduleScenario,
} from "./repo-format-scenarios.js";
import type { ScenarioOutcome } from "../scenario-types.js";

export type ScenarioRunner = (journal: JournalStore) => Promise<ScenarioOutcome>;

/** Every scenario runner, in the roadmap's own listed order. */
export const GIT_MATRIX_SCENARIOS: readonly ScenarioRunner[] = [
  runCheckoutInvarianceScenario,
  runCleanMergeScenario,
  runConflictScenario,
  runRenameCollisionScenario,
  runSha256RepoScenario,
  runSubmoduleScenario,
  runLfsPointerScenario,
  runHooksNeutralizationScenario,
  runCleanBranchCommitGoldenScenario,
  runAttributionLeakBlockedScenario,
  runCleanPublishScenario,
  runPublishAttributionLeakScenario,
];

export {
  runAttributionLeakBlockedScenario,
  runCheckoutInvarianceScenario,
  runCleanBranchCommitGoldenScenario,
  runCleanMergeScenario,
  runCleanPublishScenario,
  runConflictScenario,
  runHooksNeutralizationScenario,
  runLfsPointerScenario,
  runPublishAttributionLeakScenario,
  runRenameCollisionScenario,
  runSha256RepoScenario,
  runSubmoduleScenario,
};

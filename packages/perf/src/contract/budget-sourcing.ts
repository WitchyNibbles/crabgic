import type { PerformanceBudgetSource, ProvisionalPerformanceBudgetEntry } from "@eo/contracts";
import { parseAcceptanceCriteriaAsBudgets } from "./acceptance-criteria-parser.js";
import { ecosystemResearchBudgets } from "./ecosystem-research-table.js";

export interface ResolveBudgetSourceOptions {
  /** The `performance`-section `Requirement`(s)' acceptance criteria, when any exist for this `ChangeSet`. */
  readonly requirementAcceptanceCriteria?: readonly string[];
  /** The project's ecosystem label (`ProjectProfile.ecosystems[].ecosystem`), for the ecosystem-research fallback. */
  readonly ecosystem?: string;
}

export interface ResolvedBudgetSource {
  readonly source: PerformanceBudgetSource;
  readonly budgets: readonly ProvisionalPerformanceBudgetEntry[];
}

/**
 * Resolves budgets in roadmap/15's exact 3-source order — "in order, first
 * source that resolves wins": (1) Requirement acceptance criteria, (2)
 * ecosystem research, (3) base-revision measurement (this function's own
 * output when neither of the first two resolves is an EMPTY budget set
 * tagged `base_revision_measurement` — the caller/gate-time contract
 * builder is responsible for populating actual threshold values from the
 * measured base revision once it has run; see `./contract-builder.ts`).
 * "Resolves" means "produces at least one parseable budget entry" — an
 * `acceptanceCriteria` list that is pure prose does NOT resolve source #1,
 * and falls through to #2, exactly as an empty/absent list would.
 */
export function resolveBudgetSource(options: ResolveBudgetSourceOptions): ResolvedBudgetSource {
  if (options.requirementAcceptanceCriteria !== undefined) {
    const parsed = parseAcceptanceCriteriaAsBudgets(options.requirementAcceptanceCriteria);
    if (parsed.length > 0) {
      return { source: "requirement_acceptance_criteria", budgets: parsed };
    }
  }

  if (options.ecosystem !== undefined) {
    const researched = ecosystemResearchBudgets(options.ecosystem);
    if (researched !== undefined && researched.length > 0) {
      return { source: "ecosystem_research", budgets: [...researched] };
    }
  }

  return { source: "base_revision_measurement", budgets: [] };
}

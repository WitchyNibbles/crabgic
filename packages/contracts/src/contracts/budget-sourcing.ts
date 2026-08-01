import type {
  PerformanceBudgetSource,
  ProvisionalPerformanceBudgetEntry,
} from "./performance-contract.js";
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
 *
 * ── WIRED (ledger Gap 21, 2026-08-01) ───────────────────────────────────
 *
 * Lives here, in the base package, because the rule is a cross-phase
 * interface: phase 11's intake EXECUTES it and phase 15's gate consumes its
 * output, and 11 cannot depend on 15 (that edge is a phase-level cycle via
 * 13). Both reach it through `@crabgic/contracts`, which both already depend
 * on — the same resolution `../shared/canonical-hash.ts` and
 * `../approval/token.ts` took. `packages/perf` re-exports this module
 * verbatim, so its published surface and its own tests are unchanged.
 *
 * The sole production caller is `buildIntakeArtifacts`
 * (`@crabgic/supervisor`'s `intake-pipeline.ts`). `IntakeRequest` no longer
 * carries `performanceBudgetSource`/`performanceBudgets` at all: intake
 * DERIVES both by running this rule against the requirements it just built,
 * so a declaration that disagrees with the criteria it names is
 * unrepresentable rather than policed. Before that, the repo's own golden
 * fixture declared `requirement_acceptance_criteria` beside a budget none of
 * its criteria parse to.
 *
 * THROWS `ContradictoryCriterionDirectionError` (from source #1's parser) for a
 * criterion whose comparison operator contradicts its metric's canonical
 * direction. Falling through to source #2 in that case would silently replace
 * the author's own stated budget with an ecosystem default; see the parser's
 * own doc comment. `ecosystem` is validated by the caller — intake refuses an
 * unknown label rather than passing it here (see `ecosystemResearchBudgets`,
 * which answers only for own table rows).
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

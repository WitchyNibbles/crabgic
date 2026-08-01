import type {
  PerformanceBudgetSource,
  ProvisionalPerformanceBudgetEntry,
} from "@crabgic/contracts";
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
 * ── NOT WIRED, AND WHY (recorded 2026-08-01) ─────────────────────────────
 *
 * This function has ZERO production callers. It is correct and tested, and
 * nothing in the running system consults it: `IntakeRequest` carries
 * `performanceBudgetSource` and `performanceBudgets` as REQUIRED caller-
 * supplied fields, and `intake-pipeline.ts` copies both verbatim into the
 * provisional contract. So the sourcing ORDER roadmap/15 specifies is
 * implemented here and enforced nowhere, and a caller may declare
 * `source: "requirement_acceptance_criteria"` beside budgets that were never
 * derived from any requirement's criteria — the declaration is not checked
 * against the criteria it names.
 *
 * It is not wired because the only site that could call it —
 * `@crabgic/supervisor`'s intake pipeline, phase 11 — cannot import
 * `@crabgic/perf` (phase 15): no such edge exists in roadmap/README.md's
 * dependency graph, and `scripts/check-package-graph-acyclic.mjs` guards the
 * package graph. Adding an 11 → 15 edge, or relocating this module and
 * `./acceptance-criteria-parser.ts` into a package intake can reach (the
 * precedent is `approval/token.ts`, moved into `@crabgic/contracts` to break a
 * cycle), is a cross-phase interface decision — `docs/interface-ledger.md`'s
 * territory, not a drive-by.
 *
 * DO NOT delete this as dead code on the strength of "no callers". The gap is
 * the missing wiring, not the function; deleting it would erase the only
 * implementation of a sourcing order the phase spec still requires, and would
 * make the unchecked caller declaration above permanent rather than pending.
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

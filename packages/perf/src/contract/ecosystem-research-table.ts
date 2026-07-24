import type { ProvisionalPerformanceBudgetEntry } from "@eo/contracts";

/**
 * "Ecosystem research" budget defaults — roadmap/15 §In scope, "Budget
 * sourcing" bullet, source #2: "Else ecosystem research." This repo has no
 * live external-research capability (no network access, no research
 * pipeline package) — this is a small, hand-curated, PINNED table of
 * commonly-cited default budgets per ecosystem, standing in for a live
 * research step. **This is fixture-modeled, not live** — documented
 * honestly in `docs/evidence/phase-15/README.md`'s "fixture-modeled vs
 * live" section, matching phases 14/19/20's own precedent for a
 * source-of-truth this repo cannot genuinely reach. A future phase wiring
 * a real research pipeline replaces this table's role without changing the
 * `PerformanceBudgetSource` vocabulary or this module's call signature.
 */
export const ECOSYSTEM_RESEARCH_BUDGETS: Readonly<
  Record<string, readonly ProvisionalPerformanceBudgetEntry[]>
> = {
  node: [
    { metric: "latency", percentile: 95, threshold: 200, unit: "ms" },
    { metric: "cpu_time", threshold: 5, unit: "s" },
  ],
  python: [
    { metric: "latency", percentile: 95, threshold: 400, unit: "ms" },
    { metric: "cpu_time", threshold: 8, unit: "s" },
  ],
  go: [
    { metric: "latency", percentile: 95, threshold: 100, unit: "ms" },
    { metric: "cpu_time", threshold: 3, unit: "s" },
  ],
  rust: [
    { metric: "latency", percentile: 95, threshold: 50, unit: "ms" },
    { metric: "cpu_time", threshold: 2, unit: "s" },
  ],
};

/** The ecosystem-research budgets for `ecosystem`, or `undefined` if this phase's pinned table has no entry for it (falls through to the base-revision-measurement source). */
export function ecosystemResearchBudgets(
  ecosystem: string,
): readonly ProvisionalPerformanceBudgetEntry[] | undefined {
  return ECOSYSTEM_RESEARCH_BUDGETS[ecosystem];
}

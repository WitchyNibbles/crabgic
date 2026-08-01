import type { ProvisionalPerformanceBudgetEntry } from "./performance-contract.js";

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

/**
 * Every ecosystem this pinned table actually has a row for, sorted — the exact
 * vocabulary `IntakeRequest.ecosystem` may use. Derived from the table itself
 * so the two can never drift.
 */
export const KNOWN_RESEARCH_ECOSYSTEMS: readonly string[] = Object.freeze(
  Object.keys(ECOSYSTEM_RESEARCH_BUDGETS).sort((a, b) => a.localeCompare(b)),
);

/**
 * Whether `ecosystem` is an OWN row of the pinned table.
 *
 * `Object.hasOwn`, not `in` and not a truthiness check on the lookup: the
 * argument reaches this module straight from `JSON.parse` (intake reads its
 * request off stdin and there is no `IntakeRequestSchema`), and
 * `ECOSYSTEM_RESEARCH_BUDGETS` is an object literal, so it inherits
 * `Object.prototype`. Without this guard `TABLE["constructor"]` answered with
 * `Object` — a function of arity 1, which passed the caller's `.length > 0`
 * liveness check — and the caller then spread it, throwing
 * `TypeError: researched is not iterable` out of this package and crashing
 * `runIntake`. `hasOwnProperty`, `isPrototypeOf` and
 * `propertyIsEnumerable` are arity-1 too and behaved identically.
 */
export function isKnownResearchEcosystem(ecosystem: string): boolean {
  return Object.hasOwn(ECOSYSTEM_RESEARCH_BUDGETS, ecosystem);
}

/** The ecosystem-research budgets for `ecosystem`, or `undefined` if this phase's pinned table has no OWN entry for it (falls through to the base-revision-measurement source). */
export function ecosystemResearchBudgets(
  ecosystem: string,
): readonly ProvisionalPerformanceBudgetEntry[] | undefined {
  if (!isKnownResearchEcosystem(ecosystem)) return undefined;
  return ECOSYSTEM_RESEARCH_BUDGETS[ecosystem];
}

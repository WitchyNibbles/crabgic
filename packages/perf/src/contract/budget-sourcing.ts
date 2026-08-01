/**
 * roadmap/15's 3-source budget order.
 *
 * Implementation moved to `@crabgic/contracts` under ledger Gap 21, and it is
 * no longer unwired: `@crabgic/supervisor`'s `buildIntakeArtifacts` now derives
 * `(budgetSource, budgets)` by running it, so the caller-declared
 * `performanceBudgetSource`/`performanceBudgets` fields are gone from
 * `IntakeRequest` entirely. See the relocated module's header.
 *
 * Re-exported so this package's published surface and its own tests are
 * unchanged.
 */
export { resolveBudgetSource } from "@crabgic/contracts";
export type { ResolveBudgetSourceOptions, ResolvedBudgetSource } from "@crabgic/contracts";

/**
 * Which direction is "worse" for each `PerformanceMetric`.
 *
 * The table moved to `@crabgic/contracts` (2026-08-01) once
 * `acceptance-criteria-parser.ts` — executed by phase 11's intake, which cannot
 * depend on phase 15 — needed the same fact to reject a criterion whose
 * comparison operator contradicts its metric's canonical direction. Same
 * resolution `../contract/budget-sourcing.ts` took under ledger Gap 21.
 *
 * Re-exported rather than re-pathed so no call site changed and this package's
 * own tests still exercise it through this path.
 */
export { higherIsWorse } from "@crabgic/contracts";

/**
 * Free-text `Requirement.acceptanceCriteria` → budget parser.
 *
 * The implementation moved to `@crabgic/contracts` under ledger Gap 21: the
 * sourcing rule is a cross-phase interface, and phase 11's intake — which now
 * EXECUTES it — cannot depend on phase 15 (that edge is a phase-level cycle
 * via 13). Both sides reach it through contracts, which both already depend
 * on; the precedent is `contracts/src/shared/canonical-hash.ts`.
 *
 * Re-exported rather than re-pathed so no call site changed and this module's
 * own tests still exercise it through this path — which is what proves the
 * move changed no behavior.
 */
export {
  ContradictoryCriterionDirectionError,
  parseAcceptanceCriterionAsBudget,
  parseAcceptanceCriteriaAsBudgets,
} from "@crabgic/contracts";

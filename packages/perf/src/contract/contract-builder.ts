import {
  CURRENT_SCHEMA_VERSION,
  EnforcedPerformanceContractSchema,
  type EnforcedPerformanceBudgetEntry,
  type EnforcedPerformanceContract,
  type PerformanceMetric,
  type PerformanceOutcome,
  type ProvisionalPerformanceBudgetEntry,
  type ProvisionalPerformanceContract,
} from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import {
  BudgetHashLinkMismatchError,
  BudgetJournalAnchorMissingError,
  MissingMeasurementError,
} from "../errors.js";
import { canonicalHash } from "./canonical-hash.js";
import { verifyProvisionalBudgetIntegrity } from "./hash-link.js";

export interface MeasuredBudgetValue {
  readonly metric: PerformanceMetric;
  readonly percentile?: number;
  readonly value: number;
}

function budgetKey(metric: PerformanceMetric, percentile?: number): string {
  return `${metric}::${percentile === undefined ? "" : String(percentile)}`;
}

export interface BuildEnforcedPerformanceContractOptions {
  readonly id: string;
  readonly createdAt: string;
  readonly provisional: ProvisionalPerformanceContract;
  /**
   * The journal to read the approval-time, tamper-evident budget anchor
   * back from (`./hash-link.ts`'s `verifyProvisionalBudgetIntegrity`) —
   * required as of the adversarial-validation MAJOR fix: a self-checksum
   * alone (recompute the hash, compare to the SAME mutable record's own
   * `budgetHash` field) does not defend against a deliberate post-approval
   * widening that also recomputes its own hash consistently. See
   * `./hash-link.ts`'s file-level doc comment for the full threat model.
   */
  readonly journal: JournalStore;
  readonly outcome: PerformanceOutcome;
  /**
   * Measured candidate values, keyed by (metric, percentile). Required for
   * every entry present on the budgets this build enforces (see
   * `baseRevisionFallbackBudgets` for the one case where the budget set
   * itself, not just its measured value, is supplied here).
   */
  readonly measuredValues: readonly MeasuredBudgetValue[];
  /**
   * Only consulted when `provisional.budgetSource ===
   * "base_revision_measurement"` AND `provisional.budgets` is empty (the
   * deferred-fallback shape 11 commits at approval time when neither
   * Requirement acceptance criteria nor ecosystem research resolved any
   * budget) — the budget entries THIS gate-time run derives itself,
   * threshold sourced from the base revision's own measured value
   * (roadmap/15 §In scope, "Budget sourcing" bullet, source #3: "the
   * base-revision benchmark run sets the budget itself"). Never used, and
   * never needed, for the other two sources — those budgets are carried
   * forward from `provisional.budgets` unchanged (only `measuredValue` is
   * added), which is exactly what the hash-link check below verifies
   * wasn't tampered with.
   */
  readonly baseRevisionFallbackBudgets?: readonly ProvisionalPerformanceBudgetEntry[];
}

/**
 * Builds the enforced `PerformanceContract` instance at gate time —
 * roadmap/15 §Interfaces produced, "PerformanceContract instances, enforced
 * variant": "this phase builds the measurement-backed, hash-linked
 * instance at gate time … this phase never edits or re-derives 11's
 * provisional figure, only hash-checks against it."
 *
 * FAIL-CLOSED (never silently re-sourced): throws
 * `BudgetJournalAnchorMissingError` when no approval-time journal commit
 * exists for this provisional contract id at all, or
 * `BudgetHashLinkMismatchError` (self-consistency OR journal-anchor
 * mismatch) whenever the provisional contract's budgets no longer verify
 * against the tamper-evident approval-time record (`./hash-link.ts`) —
 * this is the tamper-evidence check roadmap/15's exit criteria require ("a
 * tampered post-approval budget fixture must fail the hash-link check and
 * block"), now genuinely bound to 04's append-only, hash-chained journal
 * rather than a self-checksum an adversary editing the same mutable record
 * could also recompute (adversarial-validation MAJOR fix).
 */
export async function buildEnforcedPerformanceContract(
  options: BuildEnforcedPerformanceContractOptions,
): Promise<EnforcedPerformanceContract> {
  const integrity = await verifyProvisionalBudgetIntegrity(options.journal, options.provisional);
  if (!integrity.ok) {
    if (integrity.reason === "no_journal_anchor") {
      throw new BudgetJournalAnchorMissingError(options.provisional.id);
    }
    throw new BudgetHashLinkMismatchError(
      integrity.reason ?? "self_consistency_mismatch",
      `provisional budgetHash "${options.provisional.budgetHash}" but the currently-stored/` +
        `journal-anchored budgets recompute to "${integrity.recomputedHash}".`,
    );
  }

  const isDeferredBaseRevisionFallback =
    options.provisional.budgetSource === "base_revision_measurement" &&
    options.provisional.budgets.length === 0;

  const sourceBudgets: readonly ProvisionalPerformanceBudgetEntry[] = isDeferredBaseRevisionFallback
    ? (options.baseRevisionFallbackBudgets ?? [])
    : options.provisional.budgets;

  const measuredByKey = new Map<string, number>();
  for (const measured of options.measuredValues) {
    measuredByKey.set(budgetKey(measured.metric, measured.percentile), measured.value);
  }

  const enforcedBudgets: EnforcedPerformanceBudgetEntry[] = sourceBudgets.map((budget) => {
    const measuredValue = measuredByKey.get(budgetKey(budget.metric, budget.percentile));
    if (measuredValue === undefined) {
      throw new MissingMeasurementError(budget.metric, budget.percentile);
    }
    return { ...budget, measuredValue };
  });

  const budgetHash = canonicalHash(
    enforcedBudgets.map(({ measuredValue: _measuredValue, ...rest }) => rest),
  );

  const contract: EnforcedPerformanceContract = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    changeSetId: options.provisional.changeSetId,
    createdAt: options.createdAt,
    variant: "enforced",
    budgetSource: options.provisional.budgetSource,
    budgets: enforcedBudgets,
    budgetHash,
    provisionalBudgetHash: options.provisional.budgetHash,
    outcome: options.outcome,
  };

  return EnforcedPerformanceContractSchema.parse(contract);
}

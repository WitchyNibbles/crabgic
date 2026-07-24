/**
 * Provisional `PerformanceContract` builder — roadmap/11-intake-contract-
 * approval.md §In scope: "provisional perf budgets" rendered at approval
 * time; roadmap/15-performance-contracts.md §Interfaces consumed, "11":
 * "the approved PerformanceContract's provisional figure and envelope
 * hash, embedded in ChangeSet (11 creates)."
 *
 * Adaptation §10 risk 9 (§Risks & open questions here): "the approval
 * preview's `PerformanceContract` budgets must present token/turn caps as
 * authoritative and any USD figures as informational only." This builder
 * does not itself render anything (rendering is 09's terminal-prompt job,
 * `packages/cli`) — it only ASSEMBLES the schema-valid budget set with its
 * own `budgetHash`; the caller is responsible for keeping that
 * authoritative/informational distinction visible when it renders the
 * result to a human (documented here so a future renderer doesn't lose the
 * requirement).
 */
import {
  CURRENT_SCHEMA_VERSION,
  ProvisionalPerformanceContractSchema,
  type ProvisionalPerformanceBudgetEntry,
  type ProvisionalPerformanceContract,
  type PerformanceBudgetSource,
} from "@eo/contracts";
import { canonicalHash } from "./canonical-hash.js";

export interface BuildProvisionalPerformanceContractOptions {
  readonly id: string;
  readonly changeSetId: string;
  readonly createdAt: string;
  readonly budgetSource: PerformanceBudgetSource;
  readonly budgets: readonly ProvisionalPerformanceBudgetEntry[];
}

/** Computes the canonical hash of a budget set alone — the value 15's enforced variant hash-links against (`provisionalBudgetHash`). Exposed so the amendment/tamper-detection path can recompute it independently of a full contract build. */
export function hashProvisionalBudgets(
  budgets: readonly ProvisionalPerformanceBudgetEntry[],
): string {
  return canonicalHash(budgets.map((b) => ({ ...b })));
}

export function buildProvisionalPerformanceContract(
  options: BuildProvisionalPerformanceContractOptions,
): ProvisionalPerformanceContract {
  const contract: ProvisionalPerformanceContract = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    changeSetId: options.changeSetId,
    createdAt: options.createdAt,
    variant: "provisional",
    budgetSource: options.budgetSource,
    budgets: [...options.budgets],
    budgetHash: hashProvisionalBudgets(options.budgets),
  };
  return ProvisionalPerformanceContractSchema.parse(contract);
}

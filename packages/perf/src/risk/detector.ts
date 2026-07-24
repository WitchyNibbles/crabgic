import type { StackEvidence } from "@eo/contracts";
import { unionDiffPathRiskCategories } from "./diff-analyzer.js";
import { stackEvidenceRiskCategories } from "./stack-evidence-risk.js";
import type { PerformanceRiskCategory } from "./categories.js";

export interface DetectPerformanceRiskOptions {
  /** Repo-relative changed paths for the work unit / ChangeSet under detection. */
  readonly diffPaths: readonly string[];
  /** 12's `StackEvidence`, when available — graceful degradation before 12 (mirrors 11's own `project.inspect` relationship, interface-ledger Gap 9). */
  readonly stackEvidence?: StackEvidence;
}

/**
 * Combined risk-category detection — roadmap/15 §In scope, "Risk
 * detection": "heuristics over diff paths + StackEvidence … a lightweight
 * risk tag, not a full benchmark." Union of diff-path heuristics and (when
 * available) `StackEvidence`-derived categories; returned as a sorted,
 * deterministic array (never a `Set`, so two detections over the identical
 * inputs are trivially comparable/serializable).
 */
export function detectPerformanceRisk(
  options: DetectPerformanceRiskOptions,
): readonly PerformanceRiskCategory[] {
  const union = new Set<PerformanceRiskCategory>(unionDiffPathRiskCategories(options.diffPaths));
  if (options.stackEvidence !== undefined) {
    for (const category of stackEvidenceRiskCategories(options.stackEvidence)) {
      union.add(category);
    }
  }
  return [...union].sort();
}

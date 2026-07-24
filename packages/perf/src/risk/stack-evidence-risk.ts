import type { StackEvidence, StackEvidenceCategory } from "@eo/contracts";
import type { PerformanceRiskCategory } from "./categories.js";

/**
 * `StackEvidence` (12) detection categories → the performance-risk
 * categories a finding in that category plausibly motivates — roadmap/15
 * §In scope, "Risk detection": "heuristics over diff paths + StackEvidence
 * … reaching this phase via 14's direct dependency on 12." `StackEvidence`'s
 * own 10 categories (manifest, lockfile, language_runtime, source_composition,
 * ci, container, infrastructure, migration, deployment_config,
 * observability_integration) describe WHAT KIND of stack fact was found, not
 * a performance-risk category directly, so this table is this phase's own
 * documented, minimal-sufficient bridge between the two vocabularies (no
 * such mapping is pinned by any cited source material).
 */
export const STACK_EVIDENCE_CATEGORY_TO_RISK: Partial<
  Record<StackEvidenceCategory, readonly PerformanceRiskCategory[]>
> = {
  migration: ["database", "dataset_size"],
  infrastructure: ["networking", "io"],
  container: ["io"],
  deployment_config: ["networking"],
};

/** Only findings at/above this confidence contribute a risk category — avoids a low-confidence guess dragging in an irrelevant category. */
export const STACK_EVIDENCE_RISK_CONFIDENCE_FLOOR = 0.5;

/**
 * Every `PerformanceRiskCategory` `StackEvidence`'s own findings plausibly
 * motivate, at/above `STACK_EVIDENCE_RISK_CONFIDENCE_FLOOR` confidence.
 */
export function stackEvidenceRiskCategories(
  stackEvidence: StackEvidence,
): ReadonlySet<PerformanceRiskCategory> {
  const categories = new Set<PerformanceRiskCategory>();
  for (const finding of stackEvidence.findings) {
    if (finding.confidence < STACK_EVIDENCE_RISK_CONFIDENCE_FLOOR) continue;
    const mapped = STACK_EVIDENCE_CATEGORY_TO_RISK[finding.category];
    if (mapped === undefined) continue;
    for (const category of mapped) {
      categories.add(category);
    }
  }
  return categories;
}

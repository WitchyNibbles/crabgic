import { ContaminationDetectedError } from "../errors.js";
import { computeCaseHash, type EvalCase } from "./case-schema.js";

export interface ContaminationReport {
  readonly contaminated: boolean;
  readonly overlappingCaseHashes: readonly string[];
  readonly overlappingProvenanceIds: readonly string[];
}

/**
 * Detects dev/held-out contamination — roadmap/22-learning-system.md §In
 * scope: "contamination checks (case-hash overlap, provenance)"; §Test
 * plan, Security: "contamination … must be detected before eval runs."
 * Pure, read-only comparison — never mutates either input array.
 */
export function detectContamination(
  devCases: readonly EvalCase[],
  heldOutCases: readonly EvalCase[],
): ContaminationReport {
  const devHashes = new Set(devCases.map((c) => computeCaseHash(c)));
  const devProvenance = new Set(devCases.map((c) => c.provenanceId));

  const overlappingCaseHashes = [
    ...new Set(heldOutCases.map((c) => computeCaseHash(c)).filter((hash) => devHashes.has(hash))),
  ];
  const overlappingProvenanceIds = [
    ...new Set(heldOutCases.map((c) => c.provenanceId).filter((id) => devProvenance.has(id))),
  ];

  return {
    contaminated: overlappingCaseHashes.length > 0 || overlappingProvenanceIds.length > 0,
    overlappingCaseHashes,
    overlappingProvenanceIds,
  };
}

/** Throws `ContaminationDetectedError` if `detectContamination` reports any overlap — call BEFORE running dev/held-out eval, never after. */
export function assertNoContamination(
  devCases: readonly EvalCase[],
  heldOutCases: readonly EvalCase[],
): void {
  const report = detectContamination(devCases, heldOutCases);
  if (report.contaminated) {
    throw new ContaminationDetectedError(
      report.overlappingCaseHashes,
      report.overlappingProvenanceIds,
    );
  }
}

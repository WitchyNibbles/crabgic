import { findEvidenceForRequirement } from "@eo/gates";
import type { JournalStore } from "@eo/journal";
import { assertNoContamination } from "./contamination.js";
import type { EvalCase } from "./case-schema.js";

export interface CaseResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface EvalSuiteResult {
  readonly passed: boolean;
  readonly results: readonly CaseResult[];
}

/**
 * Grades one case. roadmap/22-learning-system.md §In scope, "Eval infra":
 * "dev/held-out grading is executed against P14's gate framework and
 * `EvidenceRecord`s as ground truth for cases that exercise a real gate
 * outcome, rather than a second bespoke verification path." When a case
 * carries `groundTruthRequirementId`, the actual judgment is derived
 * from whether ANY `evidence_pointer` entry recorded against that same
 * `requirementId` has `exitStatus === 0` (14's own pass/fail convention —
 * `GateVerdict`/`EvidenceRecord` have no separate boolean "passed" field
 * once journaled, `exitStatus` IS the recorded verdict, `@eo/gates`'s own
 * `evidence.ts`). Cases with no ground-truth evidence link fall back to a
 * pure structural comparison against the case's own `input.actualJudgment`
 * field (fixture-modeled — this phase's own minimal-sufficient choice for
 * cases with no real gate linkage, documented as such in the phase-22
 * evidence README, not a second bespoke verification engine).
 */
export async function gradeCase(
  evalCase: EvalCase,
  journal: Pick<JournalStore, "queryEntries">,
): Promise<CaseResult> {
  if (evalCase.groundTruthRequirementId !== undefined) {
    const records = await findEvidenceForRequirement(
      journal as JournalStore,
      evalCase.groundTruthRequirementId,
    );
    const actualJudgment = records.length > 0 && records.every((r) => r.exitStatus === 0);
    const passed = actualJudgment === evalCase.expectedJudgment;
    return {
      caseId: evalCase.id,
      passed,
      detail: passed
        ? `case "${evalCase.id}" matched ground-truth EvidenceRecord verdict (${String(actualJudgment)})`
        : `case "${evalCase.id}" expected ${String(evalCase.expectedJudgment)} but ground-truth EvidenceRecord verdict was ${String(actualJudgment)}`,
    };
  }

  const actualJudgment = evalCase.input["actualJudgment"] === true;
  const passed = actualJudgment === evalCase.expectedJudgment;
  return {
    caseId: evalCase.id,
    passed,
    detail: passed
      ? `case "${evalCase.id}" matched (fixture-modeled, no gate linkage)`
      : `case "${evalCase.id}" expected ${String(evalCase.expectedJudgment)} but got ${String(actualJudgment)} (fixture-modeled, no gate linkage)`,
  };
}

/**
 * Runs a full case set. Never mixes dev/held-out contamination checking
 * into this function itself (call `assertNoContamination` separately,
 * BEFORE invoking this for either set) — kept as two composable steps so
 * a caller can run the contamination check once against both sets before
 * running either eval, matching the "detected before eval runs" ordering
 * exit criterion.
 */
export async function runEvalSuite(
  cases: readonly EvalCase[],
  journal: Pick<JournalStore, "queryEntries">,
): Promise<EvalSuiteResult> {
  const results = await Promise.all(cases.map((c) => gradeCase(c, journal)));
  return { passed: results.every((r) => r.passed), results };
}

export { assertNoContamination };

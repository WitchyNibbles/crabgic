import { isNegativeEvidence } from "@crabgic/contracts";
import { findEvidenceForRequirement } from "@crabgic/gates";
import type { JournalStore } from "@crabgic/journal";
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
 * `requirementId` is a genuine negative run, per `isNegativeEvidence`
 * (`@crabgic/contracts`). That used to read `exitStatus === 0` inline, on the
 * stated grounds that "`GateVerdict`/`EvidenceRecord` have no separate boolean
 * 'passed' field once journaled". That was accurate when written and no longer
 * is: `EvidenceRecord.gateVerdict` now carries the handler's own judgement, and
 * the exit status disagrees with it for a firing that failed while its command
 * exited zero. The helper prefers the verdict and falls back to the exit status,
 * so records journaled before the field existed grade exactly as they did.
 * Cases with no ground-truth evidence link fall back to a
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
    const actualJudgment = records.length > 0 && !records.some(isNegativeEvidence);
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

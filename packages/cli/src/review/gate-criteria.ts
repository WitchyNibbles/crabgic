import type { EvidenceRecord } from "@crabgic/contracts";

/**
 * Deriving the gate-decidable exit criterion from journaled evidence.
 *
 * `review.submit` accepts `metCriteria` as an input, which means an orchestrator
 * that misreports its gate results is believed — a limit ledger Gap 20 records
 * honestly rather than glossing. This closes it for the one criterion a tool
 * can genuinely decide, and the pipeline's own rule says it must: anything a
 * deterministic gate decides is decided by the gate.
 *
 * The signal is the one the release gate already scores on — a linked
 * `EvidenceRecord` reporting a nonzero `exitStatus` is a genuine negative run.
 */

/** The `implement` stage criterion this module owns (see `PIPELINE_STAGES`). */
export const GATES_PASS_CRITERION = "implement-gates-pass";

/**
 * Criteria the evidence PROVES met. Never a claim, always a derivation.
 *
 * An empty evidence set yields nothing, deliberately: gates that never ran are
 * not gates that passed, and treating absence of proof as proof is how a stage
 * closes on work nobody verified. A caller-supplied boolean gets that wrong for
 * free.
 *
 * Records with no `gateTag` are skipped rather than counted. Gap 6's
 * rendered-artifact evidence is not a gate firing and carries no tag; counting
 * its exit status either way would decide a gate criterion on evidence of the
 * wrong kind.
 */
export function deriveGateCriteria(records: readonly EvidenceRecord[]): readonly string[] {
  const gateRecords = records.filter((record) => record.gateTag !== undefined);
  if (gateRecords.length === 0) return [];
  const allPassed = gateRecords.every((record) => record.exitStatus === 0);
  return allPassed ? [GATES_PASS_CRITERION] : [];
}

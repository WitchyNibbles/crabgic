import type { EvidenceRecord } from "@crabgic/contracts";

/**
 * Deriving the gate-decidable exit criteria from journaled evidence.
 *
 * `review.submit` accepts `metCriteria` as an input, which means an orchestrator
 * that misreports its gate results is believed — a limit ledger Gap 20 records
 * honestly rather than glossing. This closes it for the criteria a tool can
 * genuinely decide, and the pipeline's own rule says it must: anything a
 * deterministic gate decides is decided by the gate.
 *
 * THE SIGNAL IS THE HANDLER'S VERDICT, NOT THE EXIT STATUS. An earlier version
 * of this module scored `exitStatus`, which is wrong in the dangerous direction
 * for at least one shipped gate: `createTddGate` returns `passed: false` while
 * reporting the candidate's own `exitStatus: 0` when no red baseline exists. It
 * is also wrong in the *stalling* direction, which is how the defect was found:
 * `captureRedBaseline` journals `gateTag: "tdd"` with a NONZERO exit by
 * construction, so "every gate-tagged record is a zero exit" made
 * `implement-gates-pass` permanently underivable for any ChangeSet that did TDD
 * properly. `EvidenceRecord.gateVerdict` carries the judgement now, and a record
 * without one is not a firing.
 *
 * A GATE'S HISTORY IS NOT ITS RESULT. The journal is append-only, so a gate that
 * failed, was fixed, and re-fired leaves both records behind forever. The LATEST
 * firing per tag is that tag's result; requiring every record ever written to
 * pass disqualified a ChangeSet for a failure it had already repaired.
 */

/** The `implement` stage criterion for the deterministic gate set. */
export const GATES_PASS_CRITERION = "implement-gates-pass";

/**
 * The `implement` stage's TDD criterion.
 *
 * "Tests that failed before it and pass after it" describes the `tdd` gate
 * exactly: `createTddGate` passes only when a red-baseline record exists
 * STRICTLY BEFORE the candidate's own dispatch boundary and this candidate's run
 * is green. The ordering belt lives in the gate, where it already had to, so this
 * module reads the verdict rather than re-deriving red/green pairing — a second
 * implementation of that pairing is a second thing to keep in step.
 */
export const TESTS_FIRST_CRITERION = "implement-tests-first";

/** The `integrate` stage's only criterion. */
export const FINAL_CANDIDATE_CRITERION = "integrate-final-candidate-gate";

/** The gate whose passing verdict IS `implement-tests-first`. */
const TDD_GATE_TAG = "tdd";

/**
 * Criteria that MAY be derived here, and are therefore never believed from the
 * caller.
 *
 * Exported so the composition root subtracts exactly this set rather than
 * keeping its own list. Two lists that must agree will not — this repository has
 * already paid for that lesson once, over path normalization.
 */
export const GATE_DERIVED_CRITERIA: readonly string[] = [
  GATES_PASS_CRITERION,
  TESTS_FIRST_CRITERION,
  FINAL_CANDIDATE_CRITERION,
];

export interface GateCriteriaOptions {
  /**
   * The object id being merged, for `integrate-final-candidate-gate`.
   *
   * Nothing in the evidence can say which object is the merge candidate, so this
   * is supplied. That is NOT the same as trusting the caller with the criterion:
   * naming an object id does not produce passing gates for it, and the
   * derivation still requires every tag's latest firing to be green at that exact
   * id. The residual is narrow and named — a caller may point at an OLDER
   * fully-green object — and it is much smaller than "the caller asserts the
   * final-candidate gate passed".
   *
   * Absent, the criterion does not derive at all, so the integrate stage cannot
   * close. Fail-closed is the correct direction for the last gate before merge.
   */
  readonly candidateObjectId?: string;
}

/**
 * The gate firings that count, one per tag: the latest.
 *
 * Records with no `gateTag` are skipped because they are not gate evidence at
 * all — Gap 6's rendered-artifact evidence is not a gate firing. Records with a
 * tag but no `gateVerdict` are skipped for the adjacent reason: a red baseline is
 * a pre-dispatch capture, and a record predating the field has no judgement to
 * read. Neither is evidence of a pass, so neither can produce one.
 *
 * Ordering is by `capturedAt`, falling back to array position only to break a
 * tie. Position alone would silently depend on `queryEvidence` returning journal
 * order — true today, and exactly the kind of coupling `runReviewSubmit` already
 * refuses for finding dispositions.
 */
function latestFiringByTag(records: readonly EvidenceRecord[]): ReadonlyMap<string, EvidenceRecord> {
  const latest = new Map<string, { readonly record: EvidenceRecord; readonly index: number }>();
  records.forEach((record, index) => {
    if (record.gateTag === undefined) return;
    if (record.gateVerdict === undefined) return;
    const held = latest.get(record.gateTag);
    if (held === undefined) {
      latest.set(record.gateTag, { record, index });
      return;
    }
    const supersedes =
      record.capturedAt > held.record.capturedAt ||
      (record.capturedAt === held.record.capturedAt && index > held.index);
    if (supersedes) latest.set(record.gateTag, { record, index });
  });
  return new Map([...latest].map(([tag, held]) => [tag, held.record]));
}

/**
 * Criteria the evidence PROVES met. Never a claim, always a derivation.
 *
 * An empty evidence set yields nothing, deliberately: gates that never ran are
 * not gates that passed, and treating absence of proof as proof is how a stage
 * closes on work nobody verified. A caller-supplied boolean gets that wrong for
 * free.
 *
 * NAMED LIMIT: this scores the gates that DID fire, and cannot know which gates
 * SHOULD have. That answer lives in `@crabgic/gates`' registry, and deriving it
 * here would be a second source of truth for the gate set. So a ChangeSet whose
 * `tdd` gate never fired at all can still derive this criterion off its other
 * tags — the guard against that is the registry's own `requireAtLeastOne`
 * fail-closed posture at the final-candidate boundary, not this function.
 */
export function deriveGateCriteria(
  records: readonly EvidenceRecord[],
  options: GateCriteriaOptions = {},
): readonly string[] {
  const latest = latestFiringByTag(records);
  if (latest.size === 0) return [];

  const firings = [...latest.values()];
  const allPassed = firings.every((record) => record.gateVerdict === "passed");
  const derived: string[] = [];

  if (allPassed) derived.push(GATES_PASS_CRITERION);
  if (latest.get(TDD_GATE_TAG)?.gateVerdict === "passed") derived.push(TESTS_FIRST_CRITERION);

  // "On the EXACT merge candidate, not on an earlier commit" is the whole
  // content of this criterion, so WHERE each gate last fired is checked as
  // strictly as WHETHER it passed. A tag whose latest firing sits on an older
  // object means that tag never verified this candidate, and a candidate only
  // some of the gates have seen is precisely what the criterion excludes.
  const candidate = options.candidateObjectId;
  if (
    candidate !== undefined &&
    allPassed &&
    firings.every((record) => record.objectId === candidate)
  ) {
    derived.push(FINAL_CANDIDATE_CRITERION);
  }

  return derived;
}

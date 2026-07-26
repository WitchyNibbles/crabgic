import type { TaskPacket } from "@crabgic/contracts";

/**
 * "Target drift" — roadmap/23-release-hardening.md's Orchestration-matrix
 * bullet names this vector but does not itself define it anywhere in the
 * roadmap corpus (checked: no other roadmap/docs file mentions the phrase).
 * This module documents this harness's own, deliberate interpretation,
 * following the same "this work item's own, phase-23-owned design choice"
 * pattern `e2e/report/src/checklist.ts`'s own doc comment already
 * establishes for an equally-unpinned choice.
 *
 * INTERPRETATION: a `TaskPacket`'s `baseObjectId` field is "the exact base
 * object ID (07's freeze)" (roadmap/13 §In scope, TaskPacket builder) — the
 * frozen Git object every attempt for a given `WorkUnit` is scoped against.
 * "Target drift" is what happens when a REPAIR or RESUME attempt for the
 * SAME `WorkUnit` is dispatched against a DIFFERENT `baseObjectId` than the
 * unit's original attempt — the dispatch target silently moved out from
 * under an in-flight repair/resume cycle, which would make the repair's own
 * diff scope (and 15's risk-detection heuristics, which "run over diff
 * paths") meaningless. This module's `assertNoTargetDrift` is the harness-
 * level guard against exactly that: every `TaskPacket` dispatched for one
 * `WorkUnit` across a crash-repair or limit-park-resume arc must carry the
 * IDENTICAL `baseObjectId` as the unit's first attempt.
 */
export class TargetDriftError extends Error {
  constructor(
    readonly workUnitId: string,
    readonly expectedBaseObjectId: string,
    readonly actualBaseObjectId: string,
  ) {
    super(
      `orchestration-matrix: target drift detected for work unit "${workUnitId}" — ` +
        `expected baseObjectId "${expectedBaseObjectId}", got "${actualBaseObjectId}"`,
    );
    this.name = "TargetDriftError";
  }
}

/**
 * Throws `TargetDriftError` iff `repair.baseObjectId !== original.baseObjectId`
 * for the SAME `workUnitId`. Deliberately does NOT compare any other packet
 * field (`objective`/`ownedPaths`/etc. may legitimately change between a
 * repair's packet and the original — only the frozen base object id must
 * never move). Throws (rather than merely returning a boolean) so a
 * scenario that forgets to check it fails loudly instead of silently
 * proceeding on drifted data — matching this repo's "typed refusal, never a
 * silently-ignored boolean" convention (e.g. `RepairEvidenceRequiredError`).
 */
export function assertNoTargetDrift(original: TaskPacket, repair: TaskPacket): void {
  if (original.workUnitId !== repair.workUnitId) {
    throw new Error(
      `orchestration-matrix: assertNoTargetDrift called with packets for two different work ` +
        `units ("${original.workUnitId}" vs "${repair.workUnitId}") — this assertion only ` +
        "compares attempts for the SAME work unit.",
    );
  }
  if (original.baseObjectId !== repair.baseObjectId) {
    throw new TargetDriftError(original.workUnitId, original.baseObjectId, repair.baseObjectId);
  }
}

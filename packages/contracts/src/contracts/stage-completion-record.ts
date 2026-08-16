import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { PIPELINE_STAGE_IDS, type PipelineStageId } from "./pipeline-stages.js";

/**
 * `StageCompletionRecord` — the durable answer to "has this stage closed?"
 * Owner ruling R8 (2026-08-16); ledger Gap 23's disclosed residual 2.
 *
 * WHAT IT CLOSES. `pipeline.plan` takes `completedStages` from its CALLER. That
 * lets it refuse a completion set with a HOLE in it — naming the stage jumped —
 * and leaves it unable to refuse a caller claiming a stage it never ran. The
 * residual was disclosed rather than fixed because nothing depended on the
 * answer being true.
 *
 * R8 makes something depend on it: dispatch requires the `design-gate` stage to
 * have closed. A caller-supplied completion set would mean the run path hangs on
 * a claim the claimant makes about itself, which is the sycophancy inversion
 * ledger Gap 19 part 3 exists to exclude, arriving at the one place it would be
 * most expensive.
 *
 * ⚠️ WHAT MAKES THIS RECORD WORTH ANYTHING. It is written by `review.submit`
 * from that handler's OWN closure computation — never from a field on its input.
 * There is deliberately no `closable`, `verdict` or `closed` member below, and a
 * test asserts the member list, because a record carrying the caller's answer to
 * the question it exists to answer would be a slower way of trusting the caller.
 *
 * The honest bound, stated rather than implied: `review.submit` computes closure
 * from findings on record, and a caller may submit approving verdicts with no
 * findings. So for most stages this record proves "the server decided this stage
 * closed", not "the stage deserved to close". The `design-gate` stage — the one
 * R8 makes dispatch depend on — is the exception and is where the strength is
 * needed: `resolveDesignGate` REPLACES that stage's closure rule, so its only
 * input is an `OwnerDesignVerdict`, which only the CLI can write. The chain
 * dispatch hangs on is therefore owner-anchored end to end even though the
 * general record is not.
 *
 * WHY XDG STATE AND NOT THE JOURNAL. `JournalEntryType` is closed at thirteen
 * members (ledger Gap 5) and a stage closing is not an `EvidenceRecord` — it has
 * no `objectId`, no `command` and no `toolchainFingerprint` that would be
 * anything but invented. Same reasoning, and the same store shape, as the
 * finding store, the design-verdict store and the standing `EnvelopePolicy`.
 */

/**
 * Records APPEND. A stage re-opened by an edit and re-closed writes a second
 * record rather than replacing the first, so the round it closed on the first
 * time is not erased — that is the only durable evidence of whether a stage
 * converged or was pushed through. Readers below fold over the whole list.
 */
export const StageCompletionRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    changeSetId: IdSchema,
    /**
     * Constrained to the roster rather than to a non-empty string. A record
     * naming a stage the pipeline does not have is a completion of nothing, and
     * it would satisfy an ordering check by occupying a slot no stage can fill.
     */
    stage: z.enum(PIPELINE_STAGE_IDS),
    /**
     * The round it closed on. Required, and at least 1: a stage cannot close on
     * a round that never ran, and the number is unrecoverable afterwards.
     */
    round: z.number().int().min(1),
    /**
     * What the stage closed OVER. A completion that does not say what closed
     * carries forward across an edit — the same failure `OwnerDesignVerdict`
     * binds its `designRevision` to prevent, one stage more general.
     */
    artifactRef: NonEmptyStringSchema,
    closedAt: TimestampSchema,
  })
  .strict();

export type StageCompletionRecord = z.infer<typeof StageCompletionRecordSchema>;

/**
 * The stages recorded closed for one change set, in the order they were
 * recorded, each appearing once.
 *
 * Deduplicated because records append: a re-closed stage must read as one closed
 * stage to the ordering check, not as two. Scoped to `changeSetId` because a
 * completion belonging to another change set opening a gate here would mean one
 * approved design authorized every run after it.
 */
export function completedStageIds(
  records: readonly StageCompletionRecord[],
  changeSetId: string,
): readonly PipelineStageId[] {
  const seen = new Set<PipelineStageId>();
  const ordered: PipelineStageId[] = [];
  for (const record of records) {
    if (record.changeSetId !== changeSetId) continue;
    if (seen.has(record.stage)) continue;
    seen.add(record.stage);
    ordered.push(record.stage);
  }
  return ordered;
}

/**
 * Whether one named stage has closed for one change set.
 *
 * The predicate dispatch hangs on under R8. Absence reads as NOT closed for
 * every failure — no record, another change set's record, an empty store — which
 * is the fail-safe direction: an unreadable store means dispatch refuses, and
 * refusing to start work nobody approved is the correct answer when nobody can
 * tell whether it was approved.
 */
export function stageCompleted(
  records: readonly StageCompletionRecord[],
  changeSetId: string,
  stage: PipelineStageId,
): boolean {
  return records.some((record) => record.changeSetId === changeSetId && record.stage === stage);
}

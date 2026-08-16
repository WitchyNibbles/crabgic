/**
 * Per-`JournalEntryType` payload schemas — roadmap/04-journal-idempotency-
 * leases.md work item 1: "payload (schema-versioned, typed per member
 * where 02 provides a schema — `evidence_pointer` payload validates as
 * `EvidenceRecord`, `remote_operation_record` as `RemoteOperationRecord`,
 * `run_transition` carries a (from,to) pair typed against the run-
 * lifecycle enum; other members carry a documented structured payload)."
 *
 * Two members embed an existing 02 contract verbatim (`evidence_pointer`
 * -> `EvidenceRecordSchema`, `remote_operation_record` ->
 * `RemoteOperationRecordSchema`); `run_transition` and `learning_transition`
 * are typed (from, to) pairs against their respective closed unions;
 * `work_unit_transition` is typed against `WorkUnitAttemptStatusSchema`
 * (Out-of-scope note: 04 types attempt records against 02's union, it does
 * not own the union itself). The remaining 7 members have no 02 schema of
 * their own — each carries this package's own minimal-sufficient,
 * documented structured payload (the same "minimal-sufficient, not a
 * closed union the source material never pins" pattern `@crabgic/contracts`
 * itself already uses for fields like `WorkUnit.role`).
 *
 * `adjudication_decision`'s payload is deliberately generic enough to also
 * carry this package's own internal chain-tail-repair report (see
 * `../store/repair-chain.ts`) — documented there, not here, since that is
 * a deviation this worker's brief explicitly asks to be called out.
 */

import { z } from "zod";
import {
  AcceptanceEvaluationRecordSchema,
  CriteriaApprovalSealSchema,
  EvidenceRecordSchema,
  IdSchema,
  LearningProposalStateSchema,
  NonEmptyStringSchema,
  RemoteOperationRecordSchema,
  RunLifecycleStateSchema,
  WorkUnitAttemptStatusSchema,
  type JournalEntryType,
} from "@crabgic/contracts";

/** `run_transition` — a (from, to) pair typed against the run-lifecycle enum (02, work item 1's explicit instruction). */
export const RunTransitionPayloadSchema = z
  .object({
    from: RunLifecycleStateSchema,
    to: RunLifecycleStateSchema,
  })
  .strict();

/**
 * `work_unit_transition` — typed against `WorkUnitAttemptStatus` (02).
 * `sessionId` is carried here (not just on `WorkUnit` itself) so a
 * `parked:rate_limit` entry retains the engine session id durably in the
 * journal, independent of whatever the live `WorkUnit` record currently
 * holds (roadmap/04 §In scope: "`parked:rate_limit` retains `session_id`
 * so a later `resume` can continue the same engine conversation").
 * `previousStatus` is optional context for a human/CLI reader; not
 * required for the closed-union round-trip itself.
 */
/**
 * What an attempt cost, on its terminal transition (added 2026-07-30).
 *
 * The engine reports usage on every result and nothing wrote it down, so the
 * system knew each attempt's cost only for as long as the attempt was in memory
 * and no finished run could answer "what did that cost me". For a product that
 * spends the owner's own subscription, that is the number they feel.
 *
 * Mirrors `WorkerResult.usage` (02) exactly rather than inventing a shape:
 * `turnsUsed` is always present on a real result and is the load-bearing cap
 * under subscription auth; `totalCostUsd` is optional because the engine does
 * not always report a cost.
 */
export const WorkUnitAttemptUsageSchema = z
  .object({
    turnsUsed: z.number().int().nonnegative(),
    totalCostUsd: z.number().nonnegative().optional(),
  })
  .strict();

export const WorkUnitTransitionPayloadSchema = z
  .object({
    status: WorkUnitAttemptStatusSchema,
    previousStatus: WorkUnitAttemptStatusSchema.optional(),
    sessionId: IdSchema.optional(),
    /**
     * OPTIONAL, and it must stay that way: every entry written before this
     * field existed is still valid, and an attempt the engine reported no usage
     * for is not an error — it is an attempt nobody measured.
     */
    usage: WorkUnitAttemptUsageSchema.optional(),
  })
  .strict();

/**
 * `adjudication_decision` — this package's own minimal-sufficient,
 * documented structured payload (no 02 schema exists for this member).
 * `subjectId` is optional: most adjudications are recorded against a Run
 * or WorkUnit (correlated via the entry envelope's own `runId`/
 * `workUnitId` fields — see `./journal-entry.ts`), but this package's own
 * internal chain-repair usage (see `../store/repair-chain.ts`) has no
 * single Run/WorkUnit subject.
 */
export const AdjudicationDecisionPayloadSchema = z
  .object({
    decision: NonEmptyStringSchema,
    rationale: NonEmptyStringSchema,
    subjectId: IdSchema.optional(),
    /**
     * OPTIONAL, and it must stay that way: every adjudication entry written
     * before roadmap/24 existed is still valid, and an adjudication that is
     * not an approval carries no seal.
     *
     * Approving a ChangeSet is an adjudication decision, so the seal of the
     * acceptance criteria that approval covers rides on this member rather
     * than on a 14th `JournalEntryType` — the union is closed at 13 by
     * `docs/interface-ledger.md` Gap 5, which is a ruling about entry TYPES
     * and not about payload shapes. Adding an optional field to an existing
     * payload changes no existing entry's validity.
     *
     * It is a typed field and not JSON stuffed into `rationale` because Gap
     * 20's own ruling is that what a schema can carry, a schema should carry
     * — a hand-encoded blob inside a free-text field is exactly the
     * convention-instead-of-contract shape that ruling rejects.
     */
    criteriaSeal: CriteriaApprovalSealSchema.optional(),
    /**
     * OPTIONAL for the same reason `criteriaSeal` is, and by the same ruling:
     * Gap 5 closes the entry-TYPE union at thirteen and says nothing about
     * payload shapes, and every adjudication entry written before owner ruling
     * R5 existed stays valid.
     *
     * Deciding that an attempt's granted verification commands did or did not
     * run IS an adjudication about that attempt — it is what the publish gate
     * later adjudicates on — so it rides here rather than on a fourteenth type.
     *
     * A TYPED field, not JSON in `rationale`: Gap 20's ruling is that what a
     * schema can carry, a schema should carry. It also matters more here than
     * usual — the record's whole value is that a reader can fold over it, and a
     * hand-encoded blob would put the parsing burden on every consumer.
     */
    acceptanceEvaluation: AcceptanceEvaluationRecordSchema.optional(),
  })
  .strict();

/** `remote_operation_record` — validates as `RemoteOperationRecord` (02) verbatim, per work item 1's explicit instruction. */
export const RemoteOperationRecordPayloadSchema = RemoteOperationRecordSchema;

/** `evidence_pointer` — validates as `EvidenceRecord` (02) verbatim, per work item 1's explicit instruction. */
export const EvidencePointerPayloadSchema = EvidenceRecordSchema;

/** `session_assignment` — an engine session assigned to a `WorkUnit` (06's own event; correlated via the envelope's `workUnitId`). */
export const SessionAssignmentPayloadSchema = z
  .object({
    sessionId: IdSchema,
  })
  .strict();

/** `git_freeze` — a control-repo or worktree freeze event (07). */
export const GitFreezePayloadSchema = z
  .object({
    scopePath: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
  })
  .strict();

/** `worktree_quarantine` — a worktree quarantine event (07). */
export const WorktreeQuarantinePayloadSchema = z
  .object({
    worktreePath: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
  })
  .strict();

/** `cas_ref_update` — a content-addressed-store reference update (08). */
export const CasRefUpdatePayloadSchema = z
  .object({
    ref: NonEmptyStringSchema,
    objectId: NonEmptyStringSchema,
  })
  .strict();

/** `approval_token_mint` — a `trust approve`-style approval token mint (09/11/12/22). */
export const ApprovalTokenMintPayloadSchema = z
  .object({
    tokenId: IdSchema,
    scope: NonEmptyStringSchema,
  })
  .strict();

/** `fanout_rationale` — the scheduler's rationale for a fan-out decision (13). */
export const FanoutRationalePayloadSchema = z
  .object({
    rationale: NonEmptyStringSchema,
  })
  .strict();

/** `milestone_sync` — a milestone synchronization event against an external tracker (18/21). */
export const MilestoneSyncPayloadSchema = z
  .object({
    provider: NonEmptyStringSchema,
    externalId: NonEmptyStringSchema,
  })
  .strict();

/** `learning_transition` — a (from, to) pair typed against `LearningProposalState` (02). */
export const LearningTransitionPayloadSchema = z
  .object({
    from: LearningProposalStateSchema,
    to: LearningProposalStateSchema,
  })
  .strict();

/**
 * Exhaustiveness mechanism identical to `@crabgic/contracts`'s own
 * `JOURNAL_ENTRY_TYPE_DESCRIPTIONS` trick (journal-entry-type.ts): a
 * `Record<JournalEntryType, ZodTypeAny>` object literal is valid only when
 * it declares exactly one property per union member — adding a payload
 * without a matching `JournalEntryType` member (impossible, 04 doesn't own
 * that union) or omitting one of the 13 fails `npx tsc -b packages/journal`.
 */
export const JOURNAL_ENTRY_PAYLOAD_SCHEMAS = {
  run_transition: RunTransitionPayloadSchema,
  work_unit_transition: WorkUnitTransitionPayloadSchema,
  adjudication_decision: AdjudicationDecisionPayloadSchema,
  remote_operation_record: RemoteOperationRecordPayloadSchema,
  evidence_pointer: EvidencePointerPayloadSchema,
  session_assignment: SessionAssignmentPayloadSchema,
  git_freeze: GitFreezePayloadSchema,
  worktree_quarantine: WorktreeQuarantinePayloadSchema,
  cas_ref_update: CasRefUpdatePayloadSchema,
  approval_token_mint: ApprovalTokenMintPayloadSchema,
  fanout_rationale: FanoutRationalePayloadSchema,
  milestone_sync: MilestoneSyncPayloadSchema,
  learning_transition: LearningTransitionPayloadSchema,
} satisfies Record<JournalEntryType, z.ZodTypeAny>;

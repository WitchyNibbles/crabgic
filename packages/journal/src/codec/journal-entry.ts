/**
 * The `JournalEntry` envelope — roadmap/04-journal-idempotency-leases.md
 * work item 1: "a zod `JournalEntrySchema` envelope (`schemaVersion` first
 * field using @eo/contracts conventions, `seq` monotonically increasing
 * int, `type` = JournalEntryType, `payload` ..., `prevHash`, `hash`,
 * timestamp)."
 *
 * SEQ NUMBERING (documented decision): the first entry ever appended to a
 * journal carries `seq = FIRST_SEQ = 1`, not `0`. This is deliberate:
 * `RunSnapshotSchema.journalSequenceNumber` is `z.number().int()
 * .nonnegative()` (02's own schema, this package doesn't own it) and
 * "recovery = load the latest snapshot + replay journal entries after its
 * sequence number" (04 §In scope). Starting real entries at 1 lets
 * `journalSequenceNumber = 0` mean "no entries replayed yet / before
 * genesis" cleanly, so `recover()` can always compute `entries with seq >
 * snapshot.journalSequenceNumber` uniformly, including for a run that has
 * never been snapshotted (implicit floor 0) without needing a signed or
 * `-1` sentinel that would fall outside `RunSnapshot`'s own nonnegative
 * constraint.
 *
 * Each of the 13 members is hand-written as its own `z.object(...)
 * .strict()` branch (not derived via `.map()` over `JOURNAL_ENTRY_TYPES`)
 * so every branch keeps its own precise TypeScript literal `type` and
 * `payload` shape inside the `z.discriminatedUnion` — matching this
 * repo's existing style of explicit, hand-written union members (e.g.
 * `WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS` in `@eo/contracts`) over a
 * generated one whose per-branch literal typing a `.map()` would lose.
 */

import { z } from "zod";
import {
  CURRENT_SCHEMA_VERSION,
  IdSchema,
  SchemaVersionField,
  TimestampSchema,
} from "@eo/contracts";
import {
  AdjudicationDecisionPayloadSchema,
  ApprovalTokenMintPayloadSchema,
  CasRefUpdatePayloadSchema,
  EvidencePointerPayloadSchema,
  FanoutRationalePayloadSchema,
  GitFreezePayloadSchema,
  LearningTransitionPayloadSchema,
  MilestoneSyncPayloadSchema,
  RemoteOperationRecordPayloadSchema,
  RunTransitionPayloadSchema,
  SessionAssignmentPayloadSchema,
  WorkUnitTransitionPayloadSchema,
  WorktreeQuarantinePayloadSchema,
} from "./journal-payloads.js";

/** The `seq` of the first entry ever appended to a journal — see file-level doc comment for why `1`, not `0`. */
export const FIRST_SEQ = 1;

/** Lowercase-hex SHA-256 digest shape shared by `prevHash` and `hash`. */
export const HashHexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a 64-character lowercase hex SHA-256 digest");

/**
 * Fields every entry carries regardless of `type`. `runId`/`changeSetId`/
 * `workUnitId` are optional cross-cutting correlation ids, populated by
 * the caller (via `JournalEntryInput`) independent of whatever ids a
 * given `payload` variant happens to embed — this is what makes
 * `queryEntries`'s `{ runId?; changeSetId?; workUnitId? }` filter (work
 * item 4) work uniformly across all 13 payload shapes, several of which
 * (e.g. `remote_operation_record`) carry no run/change-set/work-unit id
 * of their own inside their embedded 02 contract.
 */
const envelopeFields = {
  schemaVersion: SchemaVersionField,
  seq: z.number().int().min(FIRST_SEQ),
  prevHash: HashHexSchema,
  hash: HashHexSchema,
  timestamp: TimestampSchema,
  runId: IdSchema.optional(),
  changeSetId: IdSchema.optional(),
  workUnitId: IdSchema.optional(),
};

export const RunTransitionEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("run_transition"),
    payload: RunTransitionPayloadSchema,
  })
  .strict();
export const WorkUnitTransitionEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("work_unit_transition"),
    payload: WorkUnitTransitionPayloadSchema,
  })
  .strict();
export const AdjudicationDecisionEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("adjudication_decision"),
    payload: AdjudicationDecisionPayloadSchema,
  })
  .strict();
export const RemoteOperationRecordEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("remote_operation_record"),
    payload: RemoteOperationRecordPayloadSchema,
  })
  .strict();
export const EvidencePointerEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("evidence_pointer"),
    payload: EvidencePointerPayloadSchema,
  })
  .strict();
export const SessionAssignmentEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("session_assignment"),
    payload: SessionAssignmentPayloadSchema,
  })
  .strict();
export const GitFreezeEntrySchema = z
  .object({ ...envelopeFields, type: z.literal("git_freeze"), payload: GitFreezePayloadSchema })
  .strict();
export const WorktreeQuarantineEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("worktree_quarantine"),
    payload: WorktreeQuarantinePayloadSchema,
  })
  .strict();
export const CasRefUpdateEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("cas_ref_update"),
    payload: CasRefUpdatePayloadSchema,
  })
  .strict();
export const ApprovalTokenMintEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("approval_token_mint"),
    payload: ApprovalTokenMintPayloadSchema,
  })
  .strict();
export const FanoutRationaleEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("fanout_rationale"),
    payload: FanoutRationalePayloadSchema,
  })
  .strict();
export const MilestoneSyncEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("milestone_sync"),
    payload: MilestoneSyncPayloadSchema,
  })
  .strict();
export const LearningTransitionEntrySchema = z
  .object({
    ...envelopeFields,
    type: z.literal("learning_transition"),
    payload: LearningTransitionPayloadSchema,
  })
  .strict();

/** The full 13-member closed union — every journal entry validates against exactly one branch. */
export const JournalEntrySchema = z.discriminatedUnion("type", [
  RunTransitionEntrySchema,
  WorkUnitTransitionEntrySchema,
  AdjudicationDecisionEntrySchema,
  RemoteOperationRecordEntrySchema,
  EvidencePointerEntrySchema,
  SessionAssignmentEntrySchema,
  GitFreezeEntrySchema,
  WorktreeQuarantineEntrySchema,
  CasRefUpdateEntrySchema,
  ApprovalTokenMintEntrySchema,
  FanoutRationaleEntrySchema,
  MilestoneSyncEntrySchema,
  LearningTransitionEntrySchema,
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

const ASSIGNED_FIELDS = {
  schemaVersion: true,
  seq: true,
  prevHash: true,
  hash: true,
  timestamp: true,
} as const;

/**
 * `JournalEntryInput` — what a caller supplies to `appendEntry`; the 5
 * envelope fields `appendEntry` itself assigns (`schemaVersion`, `seq`,
 * `prevHash`, `hash`, `timestamp`) are omitted from every branch via
 * `.omit()` on the already-`.strict()` entry schema (zod's `.omit()`
 * preserves the source schema's `unknownKeys: "strict"` setting).
 */
export const JournalEntryInputSchema = z.discriminatedUnion("type", [
  RunTransitionEntrySchema.omit(ASSIGNED_FIELDS),
  WorkUnitTransitionEntrySchema.omit(ASSIGNED_FIELDS),
  AdjudicationDecisionEntrySchema.omit(ASSIGNED_FIELDS),
  RemoteOperationRecordEntrySchema.omit(ASSIGNED_FIELDS),
  EvidencePointerEntrySchema.omit(ASSIGNED_FIELDS),
  SessionAssignmentEntrySchema.omit(ASSIGNED_FIELDS),
  GitFreezeEntrySchema.omit(ASSIGNED_FIELDS),
  WorktreeQuarantineEntrySchema.omit(ASSIGNED_FIELDS),
  CasRefUpdateEntrySchema.omit(ASSIGNED_FIELDS),
  ApprovalTokenMintEntrySchema.omit(ASSIGNED_FIELDS),
  FanoutRationaleEntrySchema.omit(ASSIGNED_FIELDS),
  MilestoneSyncEntrySchema.omit(ASSIGNED_FIELDS),
  LearningTransitionEntrySchema.omit(ASSIGNED_FIELDS),
]);
export type JournalEntryInput = z.infer<typeof JournalEntryInputSchema>;

/** `CURRENT_SCHEMA_VERSION` re-exported for convenience so callers building entries don't need a second `@eo/contracts` import. */
export { CURRENT_SCHEMA_VERSION };

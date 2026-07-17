import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { ConnectorErrorKindSchema } from "../errors/connector-error.js";

/**
 * This phase's own discretionary pipeline-stage projection — not a
 * separately-named field list in roadmap/16's prose — mirroring roadmap/16
 * §In scope's Mutation pipeline bullet's own described stages verbatim:
 * "persist `RemoteOperationRecord` before network I/O, via 04's idempotency
 * registry → apply → read-back compare → verify → record," plus `conflict`
 * for roadmap/04's typed-conflict outcome ("Same id + different hash → typed
 * conflict failure, never a silent overwrite") and `failed` for a mapped
 * canonical-error outcome.
 */
export const REMOTE_OPERATION_RECORD_STATUSES = [
  "pending",
  "applied",
  "verified",
  "recorded",
  "conflict",
  "failed",
] as const;

export const RemoteOperationRecordStatusSchema = z.enum(REMOTE_OPERATION_RECORD_STATUSES);
export type RemoteOperationRecordStatus = z.infer<typeof RemoteOperationRecordStatusSchema>;

/**
 * `RemoteOperationRecord` — roadmap/02-contracts-and-schemas.md §Interfaces
 * produced table: "consumed by 16 (persists pre-I/O), 04 (idempotency
 * registry)." Field list derived from roadmap/04-journal-idempotency-
 * leases.md §In scope's Idempotency registry bullet ("keyed
 * `(operationId, contentHash)`. Same id + same hash → returns the
 * previously recorded result byte-identical, no re-execution. Same id +
 * different hash → typed conflict failure, never a silent overwrite. Backs
 * 16's `RemoteOperationRecord` (02) exactly-once pipeline...") and
 * roadmap/16's Mutation pipeline bullet ("`RemoteMutationPlan` → persist
 * `RemoteOperationRecord` before network I/O, via 04's idempotency registry
 * → apply → read-back compare → verify → record").
 */
export const RemoteOperationRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,

    /** The `RemoteMutationPlan` this record executes. */
    remoteMutationPlanId: IdSchema,

    /** roadmap/04 §In scope: "keyed `(operationId, contentHash)`" — operationId half. */
    operationId: NonEmptyStringSchema,
    /** ...contentHash half. */
    contentHash: NonEmptyStringSchema,

    /** See `REMOTE_OPERATION_RECORD_STATUSES` doc comment above. */
    status: RemoteOperationRecordStatusSchema,

    /** roadmap/16 §In scope: "...apply → read-back compare..." — the confirmed remote revision this record's read-back step observed; absent until that step has run. */
    appliedRevision: NonEmptyStringSchema.optional(),

    /**
     * When `status` is `conflict` or `failed`, the canonical connector-error
     * member (this phase's `../errors/connector-error.js`, the 10-member
     * union roadmap/02 §In scope names) this record's failure mapped to;
     * absent otherwise.
     */
    errorKind: ConnectorErrorKindSchema.optional(),

    /** The instant this record was last written — pairs with 04's append-only journal (`JournalEntryType: remote_operation_record`) that durably stores it. */
    recordedAt: TimestampSchema,
  })
  .strict();

export type RemoteOperationRecord = z.infer<typeof RemoteOperationRecordSchema>;

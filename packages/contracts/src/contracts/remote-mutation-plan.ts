import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";
import { HighImpactCapabilityFlagSchema } from "../capability-flags/high-impact-capability-flag.js";

/**
 * `RemoteMutationPlan` — roadmap/02-contracts-and-schemas.md §Interfaces
 * produced table: "consumed by 16 (pipeline), 18, 20, 21." Field list
 * derived verbatim from roadmap/16-gateway-core.md §In scope's Mutation
 * pipeline bullet: "`RemoteMutationPlan` (connection+tenant, canonical
 * target, action+capability, redacted diff, desired-state hash, idempotency
 * key, expected remote revision, impact+rollback class, envelope ref) →
 * persist `RemoteOperationRecord` before network I/O..." `requiredCapabilityFlags`
 * imports `HighImpactCapabilityFlag` from `../capability-flags/` per this
 * worker's brief, rather than redefining it — roadmap/20's own text
 * ("required `HighImpactCapabilityFlag` member(s) where applicable")
 * confirms the field is optional-and-array-valued, since not every action
 * carries a high-impact capability.
 */
export const RemoteMutationPlanSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,

    /** "connection..." half of 16's "connection+tenant" pairing. */
    externalConnectionId: IdSchema,
    /** "...+tenant" half — the tenant/org/project this plan targets within the connection. */
    tenant: NonEmptyStringSchema,

    /** roadmap/16 §In scope: "canonical target" — an opaque, provider-agnostic identifier for the resource this plan acts on. */
    canonicalTarget: NonEmptyStringSchema,

    /** "action..." half of 16's "action+capability" pairing — the provider-dispatch action key; extensible, not a closed union at this phase. */
    action: NonEmptyStringSchema,
    /** "...+capability" half — the envelope flag(s) that must already be granted before this plan reaches 16's mutation pipeline. Absent when the action carries no high-impact capability. */
    requiredCapabilityFlags: z.array(HighImpactCapabilityFlagSchema).readonly().optional(),

    /** roadmap/16 §In scope: "redacted diff" — the audit-facing diff of this plan's intended change, already redacted (never raw provider-body bytes). */
    redactedDiff: NonEmptyStringSchema,
    /** roadmap/16 §In scope: "desired-state hash" — the content hash 04's idempotency registry compares against `idempotencyKey`. */
    desiredStateHash: NonEmptyStringSchema,
    /** roadmap/16 §In scope: "idempotency key" — the `operationId` half of 04's `(operationId, contentHash)` idempotency-registry key. */
    idempotencyKey: NonEmptyStringSchema,
    /** roadmap/16 §In scope: "expected remote revision" — the precondition/ETag-equivalent revision this plan's optimistic-concurrency write is conditioned on; absent for a pure create with no prior remote state. */
    expectedRemoteRevision: NonEmptyStringSchema.optional(),

    /** "impact..." half of 16's "impact+rollback class" pairing — e.g. reversible/irreversible; extensible provider-defined vocabulary, not a closed union at this phase. */
    impactClass: NonEmptyStringSchema,
    /** "...+rollback class" half — roadmap/20 §In scope: "rollback classes (reversible → version-checked restore)." */
    rollbackClass: NonEmptyStringSchema,

    /** roadmap/16 §In scope: "envelope ref" — the `AuthorizationEnvelope` (contract owned elsewhere in this phase) this plan was authorized under. */
    envelopeId: IdSchema,
  })
  .strict();

export type RemoteMutationPlan = z.infer<typeof RemoteMutationPlanSchema>;

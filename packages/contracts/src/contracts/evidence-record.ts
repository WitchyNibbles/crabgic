import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `EvidenceRecord` (roadmap/02-contracts-and-schemas.md §In scope contract
 * list; "Interfaces produced" table row `EvidenceRecord | 04/14 (emit), 08
 * (attaches rendered PR/review-comment artifacts), 09 (surfaces via
 * `evidence <change-set-id>`), 21, 23`). Phase 14 is the primary emitter,
 * one instance per gate firing
 * (roadmap/14-quality-security-gates.md:16,40, "Every firing … emits one
 * `EvidenceRecord` (command, exit status, env/toolchain fingerprint,
 * timestamp, artifact digests, exact object ID)"), journaled as an
 * `evidence_pointer` `JournalEntryType` entry. 04 durably stores/serves
 * these records (roadmap/04-journal-idempotency-leases.md:21,59), and 09's
 * `evidence <change-set-id>` command reads them back (09-cli-and-doctor.md:
 * 37-40,132).
 */
export const EvidenceRecordSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This `EvidenceRecord`'s own identity. */
    id: IdSchema,

    /** Cross-reference to the `ChangeSet` this evidence is attached to (09:37-40, "evidence <change-set-id>"). */
    changeSetId: IdSchema,

    /**
     * Cross-reference to the `Requirement` this evidence resolves against
     * (14-quality-security-gates.md:75, "`Requirement → EvidenceRecord →
     * exact object ID` resolves in both directions"). Optional: not every
     * evidence record is requirement-scoped — e.g. Gap 6's rendered
     * PR-title/PR-body/review-comment artifacts, wrapped as `EvidenceRecord`
     * by 08, carry no `Requirement` link (interface-ledger Gap 6).
     */
    requirementId: IdSchema.optional(),

    /**
     * Cross-reference to the `WorkUnit` a per-work-unit gate fired against
     * (14:16, gates fire "at the `verifying` (per-work-unit) … stage").
     * Optional: `final_verifying`-stage gate firings verify the
     * final-integrated candidate as a whole, with no single owning
     * `WorkUnit` (14:60, "re-fire the full registered gate set … against
     * the exact integrated object ID").
     */
    workUnitId: IdSchema.optional(),

    /** The command that produced this evidence (14:16,40, "command"). */
    command: NonEmptyStringSchema,

    /** The command's exit status (14:16,40, "exit status"). */
    exitStatus: z.number().int().nonnegative(),

    /** Environment/toolchain fingerprint the command ran under (14:16,40, "env/toolchain fingerprint"). */
    toolchainFingerprint: NonEmptyStringSchema,

    /** When this evidence was captured (14:16,40, "timestamp"). */
    capturedAt: TimestampSchema,

    /**
     * Content digests of raw artifacts this evidence references, never
     * inlining raw output (14:16,40, "artifact digests"; 13:45,
     * "referenced by 14's EvidenceRecord artifact-digest fields"; 14:49,
     * "this phase's `EvidenceRecord.artifactDigests` reference them, never
     * inlining raw output").
     */
    artifactDigests: z.array(NonEmptyStringSchema),

    /**
     * The exact Git object id this evidence was captured against (14:16,40,
     * "exact object ID"). A Git object id, not a UUID —
     * `NonEmptyStringSchema`, matching `TaskPacket.baseObjectId`'s same
     * choice.
     */
    objectId: NonEmptyStringSchema,

    /**
     * The risk-tag/gate identifier that produced this evidence (14:16, the
     * gate registry is "risk-tag-keyed"; tags incl. `tdd`, `coverage`,
     * `security`, `engine-conformance`, and `IntentContract` section
     * names). Optional: Gap 6's rendered-artifact evidence (08) is not a
     * gate firing and carries no gate tag — this phase's own
     * minimal-sufficient choice to accommodate both evidence sources on
     * one schema rather than a discriminated union no source material
     * pins.
     */
    gateTag: NonEmptyStringSchema.optional(),

    /**
     * The gate handler's OWN pass/fail judgement for this firing.
     *
     * WHY THIS IS NOT `exitStatus`. `exitStatus` was serving as the proxy, and
     * for a shipped gate the two genuinely disagree: `@crabgic/gates`'
     * `createTddGate` returns `passed: false` while reporting the candidate's
     * own `exitStatus: 0` whenever no red-baseline record exists. A consumer
     * reconstructing pass/fail from the exit status therefore reads that FAILED
     * firing as a pass — wrong in the one direction that matters for a field the
     * release gate and the review pipeline both score on. Only the handler knows
     * its own verdict, so the handler records it.
     *
     * Optional, and absent is MEANINGFUL rather than unset: it means "this
     * record is not a gate firing and has no verdict to report". Two real
     * sources of that — a `captureRedBaseline` pre-dispatch capture, which
     * deliberately carries `gateTag: "tdd"` with a nonzero exit and is not a
     * firing; and Gap 6's rendered-artifact evidence (08), which carries no
     * `gateTag` either. A consumer scoring gate results skips both rather than
     * guessing, which is also what stops a correctly-captured red baseline from
     * disqualifying its own ChangeSet forever.
     *
     * Records journaled before this field existed carry no verdict and so are
     * skipped too. That fails closed: the tag has no scoreable result until it
     * fires again, which is the safe direction.
     */
    gateVerdict: z.enum(["passed", "failed"]).optional(),
  })
  .strict();

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/**
 * Was this record a genuine negative run?
 *
 * The recorded verdict wins where there is one, and `exitStatus` answers where
 * there is not. That fallback is what makes this safe to adopt: every record
 * journaled before `gateVerdict` existed scores exactly as it did before, and a
 * record with no verdict may not be a firing at all — the exit status is then
 * the only thing there is to read.
 *
 * Lives here, beside the schema, because three consumers had each written
 * `exitStatus !== 0` inline with a comment explaining that no recorded verdict
 * existed to consult. That was true when they were written and is not now, and
 * one implementation of the question beats three that have to agree.
 *
 * NOT the same question as "may a stage close on this". `deriveGateCriteria` in
 * `@crabgic/cli` deliberately refuses the fallback: for a closure decision, a
 * gate-tagged record with no verdict is unproven rather than presumed green.
 */
export function isNegativeEvidence(record: EvidenceRecord): boolean {
  if (record.gateVerdict !== undefined) return record.gateVerdict === "failed";
  return record.exitStatus !== 0;
}

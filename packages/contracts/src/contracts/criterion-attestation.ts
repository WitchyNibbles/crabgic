import { z } from "zod";
import { NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `CriterionAttestation` — an attributed claim that a JUDGED exit criterion is
 * met.
 *
 * WHY THIS EXISTS. Four of the pipeline's exit criteria are derived from evidence
 * and cannot be claimed (interface-ledger Gap 20, amended 2026-07-29). The rest
 * are judgements: "every risk the design records carries either a mitigation or an
 * explicit statement that it is accepted, and why". No tool can decide that while
 * the design is narrative prose, and the ledger records so.
 *
 * What the ledger ALSO recorded is that those criteria arrived as bare strings in
 * a `metCriteria` array. An anonymous boolean is the weakest possible form a claim
 * can take: nobody said it, nothing points at what it describes, and a misreport
 * leaves no trace. The criterion cannot be decided by a tool — but the CLAIM can
 * be made attributable, which is a different property and a reachable one.
 *
 * So this is the same move Gap 20 part 1 made for findings, applied one level out.
 * A `blocking` finding must name the criterion it violates or the schema refuses
 * it; an attestation must name who asserted it, why, and where in the artifact to
 * look. What it costs a caller is a sentence. What it buys is that a stage closed
 * on judgement has a record of whose judgement, checkable against the artifact by
 * anyone who doubts it later.
 *
 * THIS IS NOT VERIFICATION AND IS NOT PRESENTED AS ANY. A rationale can be
 * plausible and wrong, and an anchor can point at a section that does not say what
 * the attestation claims. The gain is falsifiability: a claim with an author and a
 * location can be checked and found wanting, which an anonymous `true` cannot.
 */

export const CriterionAttestationSchema = z
  .object({
    /**
     * The exit criterion id, from `PIPELINE_STAGES`.
     *
     * An id that resolves to nothing is not a constraint — the same reason a
     * finding's `violates` must name a real criterion. The handler rejects ids
     * that are not required by the stage being submitted, and discards ids the
     * server derives for itself.
     */
    criterion: NonEmptyStringSchema,

    /**
     * WHO asserts it — a reviewer lens, an agent name, or a person.
     *
     * Free-form because this repository has no identity system to validate
     * against, and inventing one here would be a second answer to "who is acting"
     * that could disagree with whatever a later phase decides. Required and
     * non-empty regardless: "someone judged this" is the minimum an attribution
     * can mean, and an empty asserter is the anonymous boolean again wearing a
     * field name.
     */
    asserter: NonEmptyStringSchema,

    /**
     * WHY it is met, in the asserter's own words.
     *
     * Required non-empty for the same reason `dispositionEvidence` is: a claim
     * with no argument behind it cannot be disagreed with, only accepted or
     * ignored, and both of those are how the superseded loop failed.
     */
    rationale: NonEmptyStringSchema,

    /**
     * WHERE to look — a path, section, heading or artifact id in the thing being
     * judged.
     *
     * This is the falsifiability half. "Every acceptance criterion is addressed by
     * a named element of the design" is checkable by a reader who is told which
     * part of the design to read, and unfalsifiable otherwise. It is deliberately
     * not validated as a path: design artifacts are not all files, and a
     * validator that only accepted paths would push callers into naming a file
     * they did not mean.
     */
    artifactAnchor: NonEmptyStringSchema,

    /** When it was asserted. Persisted, so a later round can see what is stale. */
    assertedAt: TimestampSchema,

    /** The review round it was asserted in. */
    round: z.number().int().positive(),
  })
  .strict();

export type CriterionAttestation = z.infer<typeof CriterionAttestationSchema>;

/**
 * A stored attestation, plus the stage it was made for.
 *
 * The stage is part of the identity rather than the payload: two stages can share
 * a criterion name in principle, and an attestation carried across stage
 * boundaries would be a judgement about one artifact answering for another.
 */
export const StoredAttestationSchema = CriterionAttestationSchema.extend({
  stage: NonEmptyStringSchema,
}).strict();

export type StoredAttestation = z.infer<typeof StoredAttestationSchema>;

/** Identity for supersession: one live attestation per stage and criterion. */
export function attestationKey(attestation: StoredAttestation): string {
  return `${attestation.stage}:${attestation.criterion}`;
}

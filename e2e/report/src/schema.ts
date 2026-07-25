import { z } from "zod";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "@eo/contracts";

/**
 * `ReleaseGateReport` — roadmap/23-release-hardening.md, §In scope
 * ("Release-gate report generator (`e2e/release-gate-report.json`) reading
 * the journal (04) `EvidenceRecord`s and scoring every checklist item in
 * Exit criteria"), work item 1, §Interfaces produced ("`e2e/release-gate-
 * report.json` (introduced here; phase-23-internal) — the checklist-item ->
 * `EvidenceRecord` audit trail, archived by the `release-e2e` CI job").
 *
 * Phase 23 is the terminal phase (roadmap's own "Unlocks: —") — nothing
 * downstream consumes this schema, so it is deliberately NOT one of
 * `@eo/contracts`'s 21 cross-cutting contracts (that package's own barrel
 * doc comment: "every cross-cutting type in the system exists exactly
 * once" there). This schema instead lives entirely under this phase's own
 * `e2e/report/` — it embeds `@eo/contracts`'s `IdSchema`/`NonEmptyStringSchema`/
 * `TimestampSchema` shared primitives (the same building blocks every 02
 * contract uses) but defines its own local `schemaVersion` literal rather
 * than reusing `CURRENT_SCHEMA_VERSION` (that constant's own doc comment
 * scopes it to "this phase's [02's] 21 contracts" specifically).
 *
 * TRI-STATE VERDICT (roadmap work item 1's own instruction: "failing-test-
 * first: generator FAILs a checklist item with zero linked EvidenceRecords,
 * before any harness feeds it real runs" + this work item's own test-plan
 * brief): a checklist item's verdict is exactly one of:
 *
 *   - `"PASS"`             — >=1 linked `EvidenceRecord` was found for the
 *                             release-candidate object ID, matching this
 *                             item's required gate tag(s), and EVERY linked
 *                             record reports `exitStatus === 0`.
 *   - `"FAIL"`              — either (a) >=1 linked record reports a
 *                             nonzero `exitStatus` (a run happened and
 *                             produced a genuine negative result), or (b)
 *                             ZERO linked records exist AND the report was
 *                             generated in `"final"` `scoringMode` (the
 *                             release-cut mode, where a required item with
 *                             no evidence is a release blocker, never a
 *                             silent PASS).
 *   - `"EVIDENCE-PENDING"`  — ZERO linked records exist AND the report was
 *                             generated in `"interim"` `scoringMode` — "no
 *                             run attempted yet", distinct from a genuine
 *                             FAIL. Only reachable pre-release, while 23's
 *                             own work items 2-10 are still being wired in;
 *                             `"final"`-mode scoring collapses this case to
 *                             `"FAIL"` directly (see `generator.ts`), so a
 *                             `"final"`-mode report can only ever contain
 *                             `"PASS"`/`"FAIL"` items — never
 *                             `"EVIDENCE-PENDING"`.
 *
 * The core invariant every unit/property test in this directory proves:
 * PASS is NEVER the generator's default for missing evidence, in EITHER
 * mode — the two "no evidence" outcomes are FAIL (final) or PENDING
 * (interim), never PASS. This is the fail-first/default-deny behavior the
 * roadmap's work item 1 names explicitly.
 */

export const RELEASE_GATE_SCHEMA_VERSION = 1 as const;
export const ReleaseGateSchemaVersionField = z.literal(RELEASE_GATE_SCHEMA_VERSION);

export const ReleaseGateVerdictSchema = z.enum(["PASS", "FAIL", "EVIDENCE-PENDING"]);
export type ReleaseGateVerdict = z.infer<typeof ReleaseGateVerdictSchema>;

/** `"final"` is the real release-cut mode (missing evidence -> FAIL); `"interim"` is every pre-release dry run (missing evidence -> EVIDENCE-PENDING). */
export const ReleaseGateScoringModeSchema = z.enum(["interim", "final"]);
export type ReleaseGateScoringMode = z.infer<typeof ReleaseGateScoringModeSchema>;

/**
 * A single linked `EvidenceRecord` reference, copied verbatim (never
 * re-derived) from the journal's `evidence_pointer` entry that satisfied a
 * checklist item — "linking to >=1 EvidenceRecord (by the EvidenceRecord's
 * exact object ID + digest)" (this work item's own brief). Carrying the
 * `objectId` + `artifactDigests` inline (not just `evidenceRecordId`) means
 * the archived `e2e/release-gate-report.json` is itself a self-contained
 * audit trail — a reviewer can spot-check which exact commit and which
 * exact content digest backed a PASS without re-opening the journal.
 */
export const ReleaseGateEvidenceLinkSchema = z
  .object({
    /** The linked `EvidenceRecord.id` (02's `IdSchema` — a UUID). */
    evidenceRecordId: IdSchema,
    /** The linked `EvidenceRecord.objectId` — must equal the report's own `releaseCandidateObjectId` for this link to have been made at all (see `generator.ts`). */
    objectId: NonEmptyStringSchema,
    /**
     * The linked `EvidenceRecord.artifactDigests` — copied verbatim, never
     * re-derived.
     *
     * Deliberately NOT `.min(1)`. It was, until 2026-07-25, and that
     * contradicted the very record it copies: 02's `EvidenceRecordSchema`
     * declares `z.array(NonEmptyStringSchema)` with no minimum, and real
     * emitters (`e2e/live/src/evidence.ts`,
     * `e2e/matrix/orchestration/src/evidence.ts`) legitimately emit `[]`.
     * A schema that copies a field verbatim must not impose a constraint
     * its source does not have. The bug was unreachable only because no
     * evidence had ever successfully linked; the moment the shared
     * release-candidate journal made linking work, generating a report
     * hard-failed with `ZodError: too_small`.
     */
    artifactDigests: z.array(NonEmptyStringSchema),
    /** The linked `EvidenceRecord.gateTag`, when present. */
    gateTag: NonEmptyStringSchema.optional(),
    /** The linked `EvidenceRecord.exitStatus` (0 = green, nonzero = a genuine negative run). */
    exitStatus: z.number().int().nonnegative(),
  })
  .strict();
export type ReleaseGateEvidenceLink = z.infer<typeof ReleaseGateEvidenceLinkSchema>;

export const ReleaseGateChecklistItemResultSchema = z
  .object({
    /** Stable slug identifying this checklist item (see `checklist.ts`). */
    id: NonEmptyStringSchema,
    /** Human-readable text of the exit-criteria bullet this item scores. */
    description: NonEmptyStringSchema,
    /** Every one of roadmap/23's 15 Exit-criteria items is required; the field exists so a future, genuinely optional item never has to change this schema's shape. */
    required: z.boolean(),
    verdict: ReleaseGateVerdictSchema,
    /** Every `EvidenceRecord` matched for this item against the release-candidate object ID — non-empty iff `verdict !== "EVIDENCE-PENDING"` and `verdict !== "FAIL"` via the zero-evidence path (a FAIL from a genuine negative record DOES carry linked evidence). */
    linkedEvidence: z.array(ReleaseGateEvidenceLinkSchema),
    /** A short, deterministic (non-timestamped) machine-readable explanation of how `verdict` was reached. */
    reason: NonEmptyStringSchema,
  })
  .strict();
export type ReleaseGateChecklistItemResult = z.infer<typeof ReleaseGateChecklistItemResultSchema>;

export const ReleaseGateReportSchema = z
  .object({
    schemaVersion: ReleaseGateSchemaVersionField,
    /** The exact release-candidate Git object ID every linked `EvidenceRecord` in this report was captured against (roadmap/23 Exit criteria: "each linked to >=1 EvidenceRecord from the exact release-candidate object ID"). */
    releaseCandidateObjectId: NonEmptyStringSchema,
    generatedAt: TimestampSchema,
    scoringMode: ReleaseGateScoringModeSchema,
    items: z.array(ReleaseGateChecklistItemResultSchema).min(1),
    /** `FAIL` if any item is `FAIL`; else `EVIDENCE-PENDING` if any item is `EVIDENCE-PENDING`; else `PASS`. Never `PASS` unless every single item is `PASS` — see `generator.ts`'s `computeOverallVerdict`. */
    overallVerdict: ReleaseGateVerdictSchema,
  })
  .strict();
export type ReleaseGateReport = z.infer<typeof ReleaseGateReportSchema>;

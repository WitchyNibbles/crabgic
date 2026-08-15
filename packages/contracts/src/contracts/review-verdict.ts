import { z } from "zod";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { SchemaVersionField } from "../shared/schema-version.js";

/**
 * `ReviewVerdict` — interface-ledger Gap 19 as amended 2026-07-29, and the
 * enforceable half of `docs/staged-review-pipeline.md`.
 *
 * WHY THIS EXISTS. The manager protocol already states every rule below in
 * prose. Prose is not enforcement — the same reason
 * `hooks/stop-autonomy-gate.mjs` exists beside the protocol's "never ask
 * permission to keep going" paragraph. The superseded loop's failure was a
 * model instruction ("do not approve it") that no artifact could contradict,
 * and it ran twelve rounds without converging. What can be checked is checked
 * here.
 *
 * THREE PROPERTIES ARE UNREPRESENTABLE RATHER THAN DISCOURAGED:
 *
 *   1. a `blocking` finding that names no exit criterion — the rule that makes
 *      termination possible, and exactly the kind of instruction a model
 *      satisfies loosely if only asked nicely;
 *   2. a finding with an empty disposition — the owner's constraint that known
 *      issues never pass unvalidated or unhandled, which is what stops
 *      `advisory` becoming a disposal route;
 *   3. `approve` while a blocking finding is still open — a reviewer approving
 *      over its own unresolved blocker is the failure this amendment risks
 *      introducing, so the schema refuses to represent it.
 */

/**
 * The reviewer's verdict vocabulary.
 *
 * `approve` existing at all is the amendment. Measured: over twelve rounds
 * against one subsystem, a reviewer charter that forbade approval produced a
 * genuine reproducible finding every single round, with severity falling the
 * whole way, and never closed.
 */
export const REVIEW_VERDICTS = ["approve", "revise"] as const;
export const ReviewVerdictKindSchema = z.enum(REVIEW_VERDICTS);
export type ReviewVerdictKind = z.infer<typeof ReviewVerdictKindSchema>;

/**
 * Whether the finding is TRUE.
 *
 * Deliberately separate from whether it BLOCKS. Collapsing the two is how a
 * real defect gets dismissed for being minor, and how a taste preference gets
 * treated as a defect for being argued loudly.
 */
export const FINDING_VERIFICATIONS = ["confirmed", "refuted", "unverified"] as const;
export const FindingVerificationSchema = z.enum(FINDING_VERIFICATIONS);
export type FindingVerification = z.infer<typeof FindingVerificationSchema>;

/** Whether the finding holds its stage open. */
export const FINDING_CLASSIFICATIONS = ["blocking", "advisory"] as const;
export const FindingClassificationSchema = z.enum(FINDING_CLASSIFICATIONS);
export type FindingClassification = z.infer<typeof FindingClassificationSchema>;

/**
 * What was DONE about the finding.
 *
 * There is no member meaning "ignored", and that absence is the design: every
 * disposition is an answer. `advisory` defers a finding; only a disposition
 * disposes of one.
 */
export const FINDING_DISPOSITIONS = ["fixed", "refuted", "accepted-debt"] as const;
export const FindingDispositionSchema = z.enum(FINDING_DISPOSITIONS);
export type FindingDisposition = z.infer<typeof FindingDispositionSchema>;

/**
 * The hard ceiling on review rounds for one stage.
 *
 * The real bound is progress — a stage loops while each round closes at least
 * one blocking finding. This exists only so a pathological stage cannot run
 * forever if progress is mis-measured; the literature's caution that a fixed
 * cap is a "syntactic kill-switch" is why it is the backstop and not the rule.
 *
 * **SUPERSEDED as the closure rule by owner ruling R4 (2026-08-15)**, and left
 * here verbatim rather than rewritten, per this repository's
 * annotate-never-rewrite convention. R4 re-opened the zero-findings exit: a
 * stage now closes on a round producing no admissible novel finding, severity
 * playing no part. The progress rule this constant served — "loops while each
 * round closes at least one blocking finding" — is no longer what ends a loop.
 * The value is retained because the manager protocol still renders it and
 * because removing a published constant is a separate, coordinated change.
 */
export const REVIEW_ROUND_CEILING = 5;

/**
 * The runaway guard — what bounds a stage's rounds under ruling R4.
 *
 * A loop reaching this value has **stalled**, not closed
 * (`packages/cli/src/review/admissibility.ts` reports the distinction), and
 * under ruling R3 the caller takes its declared default rather than halting for
 * the owner.
 *
 * It exists for the one thing the admissibility bounds do not prove: a repair
 * writes new code, new code carries new obligations, so termination rests on the
 * repair rate exceeding the new-obligation rate — empirical, not proved. Set
 * well above any healthy loop and deliberately not yet tuned; the first measured
 * runs move it.
 */
export const REVIEW_RUNAWAY_GUARD = 20;

/**
 * The falsifiability evidence. Required, and required non-empty: a finding
 * nobody can reproduce costs a verification cycle and teaches the manager to
 * discount the reviewer.
 */
export const FindingEvidenceSchema = z.object({
  reproduction: NonEmptyStringSchema,
  observed: NonEmptyStringSchema,
  expected: NonEmptyStringSchema,
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

const FindingShapeSchema = z.object({
  id: IdSchema,
  claim: NonEmptyStringSchema,
  evidence: FindingEvidenceSchema,
  verification: FindingVerificationSchema,
  classification: FindingClassificationSchema,
  /** The exit criterion this finding violates. Required for `blocking`, meaningless otherwise. */
  violates: NonEmptyStringSchema.optional(),
  /**
   * Absent only while the finding is still open. A stage may not ADVANCE
   * holding one that is absent — see `isStageClosable` — but a verdict may
   * legitimately report a finding raised this round and not yet answered.
   */
  disposition: FindingDispositionSchema.optional(),
  dispositionEvidence: z.string().optional(),
  /**
   * Repository paths the finding concerns, normalized by the caller with
   * `normalizePlannedPath` from `@crabgic/git-engine`.
   *
   * This is what makes deferred debt findable again: it turns `blocking` when
   * a later change set's `PlannedWriteSet` intersects these paths. Debt with
   * no paths could never be re-raised, so `accepted-debt` requires at least
   * one — an untargetable deferral is indistinguishable from dropping it.
   */
  paths: z.array(NonEmptyStringSchema).default([]),
});

export const ReviewFindingSchema = FindingShapeSchema.superRefine((finding, ctx) => {
  if (finding.classification === "blocking" && finding.violates === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["violates"],
      message:
        "a blocking finding must name the exit criterion it violates; one that violates no stated criterion is advisory",
    });
  }

  if (finding.disposition !== undefined) {
    if ((finding.dispositionEvidence ?? "").trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["dispositionEvidence"],
        message:
          "a disposition must carry its evidence — this is what stops a finding being filed and forgotten",
      });
    }
    if (finding.disposition === "accepted-debt" && finding.paths.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["paths"],
        message:
          "accepted-debt must name the paths it concerns, or it can never become blocking when that code is next touched",
      });
    }
  }
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/** A blocking finding is resolved only by being fixed or refuted — never by being deferred. */
function isBlockingAndUnresolved(finding: ReviewFinding): boolean {
  return (
    finding.classification === "blocking" &&
    finding.disposition !== "fixed" &&
    finding.disposition !== "refuted"
  );
}

export const ReviewVerdictSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    createdAt: TimestampSchema,
    /** The pipeline stage under review. */
    stage: NonEmptyStringSchema,
    /** What was reviewed — a ChangeSet, a design document, a diff. */
    artifactRef: NonEmptyStringSchema,
    /** The reviewer's lens. Rounds differ by lens rather than repeating one hostile pass. */
    lens: NonEmptyStringSchema,
    verdict: ReviewVerdictKindSchema,
    /**
     * Bounded by the runaway guard, not by the superseded ceiling.
     *
     * Under R4 a healthy stage closes on the first quiet round, which is usually
     * far below either number. Capping the SCHEMA at 5 would have made round 6
     * unrepresentable — so a stalling stage could not even report the state that
     * triggers its escalation, and the guard would be unreachable by
     * construction.
     */
    round: z.number().int().min(1).max(REVIEW_RUNAWAY_GUARD),
    findings: z.array(ReviewFindingSchema).default([]),
  })
  .superRefine((verdict, ctx) => {
    if (verdict.verdict !== "approve") return;
    const unresolved = verdict.findings.filter(isBlockingAndUnresolved);
    if (unresolved.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["verdict"],
        message: `cannot approve while ${String(unresolved.length)} blocking finding(s) remain unfixed and unrefuted`,
      });
    }
  });
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export interface StageClosureInput {
  /** Exit-criterion ids this stage has satisfied. */
  readonly metCriteria: readonly string[];
  /** Every exit criterion the stage must satisfy. */
  readonly requiredCriteria: readonly string[];
  readonly findings: readonly ReviewFinding[];
}

/**
 * Whether a stage may advance.
 *
 * All three conditions, and the first is the one the superseded loop lacked:
 * termination is the artifact against its written criteria, never the reviewer
 * running out of things to say. A stage with a clean review and an unmet
 * criterion is not done, and a stage with every criterion met is not done while
 * it still holds an unanswered finding — at any severity.
 */
export function isStageClosable(input: StageClosureInput): boolean {
  const met = new Set(input.metCriteria);
  if (!input.requiredCriteria.every((criterion) => met.has(criterion))) return false;
  if (input.findings.some(isBlockingAndUnresolved)) return false;
  return input.findings.every((finding) => finding.disposition !== undefined);
}

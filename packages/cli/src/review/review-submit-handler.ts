import {
  CriterionAttestationSchema,
  DEBT_REOPENED_CRITERION,
  PIPELINE_STAGE_IDS,
  REVIEW_ROUND_CEILING,
  ReviewVerdictSchema,
  exitCriteriaFor,
  isStageClosable,
  reclassifyDebtForWriteSet,
  selectDebtTouchedBy,
  type PipelineStageId,
  type ReviewFinding,
  type ReviewVerdict,
  type CriterionAttestation,
  type StoredAttestation,
} from "@crabgic/contracts";
import { GATE_DERIVED_CRITERIA } from "./gate-criteria.js";

/**
 * `review.submit` — the wiring ledger Gap 20 recorded as missing.
 *
 * Gap 20 shipped the schema, the closure rule and the debt index as "correct,
 * tested, and unwired", which makes them a contract the manager MAY follow.
 * This is what makes it must: **closure is computed here, from the findings on
 * record**, and returned to the caller. A manager cannot assert that a stage is
 * done any more than it can mint its own approval token — the same principle as
 * `contract.approve`, and the same reason (adaptation §5.5: the model must not
 * be able to satisfy its own approval gate).
 *
 * Three things are deliberately NOT taken from the caller:
 *
 *   - which criteria the stage requires (from `PIPELINE_STAGES`);
 *   - which criteria are met (from the caller's own gates and prior records,
 *     never from the verdict document);
 *   - whether the stage may close (computed by `isStageClosable`).
 *
 * A reviewer supplies findings. It does not supply the verdict on itself.
 */

export interface ReviewSubmitDeps {
  /** Journals the verdict. Never called for a document that failed validation. */
  readonly appendEvidence: (record: ReviewEvidence) => Promise<void>;
  /** Findings already on record for this artifact and stage. */
  readonly priorFindings: () => readonly ReviewFinding[];
  /** The paths this change set intends to write, for reopening debt. */
  readonly plannedWrites: () => readonly string[];
  /**
   * Exit criteria the caller claims as bare strings.
   *
   * Kept, and no longer BELIEVED. Every criterion here is either derived by the
   * server — in which case the claim is irrelevant — or judged, in which case it
   * needs an attestation. A bare string is reported back in `unattestedCriteria`
   * rather than dropped in silence, so a caller using the old shape is told why
   * its criterion stayed unmet instead of having to guess.
   */
  readonly metCriteria: () => readonly string[];
  /** Attestations already on record for this stage, from earlier rounds. */
  readonly priorAttestations?: () => readonly StoredAttestation[];
  /**
   * How well the blocking/advisory classifier agrees with the owner, if anyone
   * has checked.
   *
   * Reported on every response rather than logged somewhere, because the split
   * decides what holds a stage open and a consumer acting on it deserves to
   * know whether it has ever been validated. An unvalidated classifier is not
   * an error — it is the normal state of a fresh project — but silently
   * presenting its verdicts as though they were measured is.
   */
  readonly calibration: () => CalibrationStatus;
}

export interface CalibrationStatus {
  readonly calibrated: boolean;
  readonly kappa: number;
  /**
   * The 95% interval's lower bound — the number `calibrated` is actually decided
   * on. Reported beside the estimate rather than instead of it, because the gap
   * between the two IS the state of the corpus: a wide gap means "not enough
   * evidence yet", a narrow one means "this is what the classifier is".
   */
  readonly kappaLowerBound: number;
  readonly sampleSize: number;
  readonly samplesNeeded: number;
  /**
   * One sentence naming what is missing. Present even when calibrated, because a
   * consumer reading `calibrated: false` with no reason is back to the caveat
   * this whole mechanism replaced.
   */
  readonly verdictReason: string;
}

export interface ReviewEvidence {
  readonly kind: "review.verdict";
  readonly stage: string;
  readonly lens: string;
  readonly round: number;
  readonly verdict: string;
  readonly findingCount: number;
  readonly stageClosable: boolean;
}

export interface ReviewSubmitInput {
  readonly stage: string;
  readonly verdict: unknown;
  /**
   * Attributed claims that the stage's JUDGED criteria are met.
   *
   * Validated by `CriterionAttestationSchema`, so an anonymous or unanchored claim
   * is rejected rather than counted. Unvalidated here because the shape belongs to
   * the schema and a second copy of it would drift.
   */
  readonly attestations?: readonly unknown[];
}

/** A claim that could not be honoured, and the reason, returned rather than dropped. */
export interface IgnoredAttestation {
  readonly criterion: string;
  readonly reason: string;
}

/** A well-formed claim that a finding on record contradicts. */
export interface VoidedAttestation {
  readonly criterion: string;
  /** The unresolved blocking finding that names this criterion in `violates`. */
  readonly contradictedBy: string;
}

export interface ReviewSubmitResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly stageClosable?: boolean;
  readonly unmetCriteria?: readonly string[];
  readonly openBlocking?: number;
  readonly undispositioned?: number;
  readonly reopenedDebt?: number;
  readonly escalate?: boolean;
  readonly escalationReason?: string;
  /**
   * The full finding set after merging this round and reopening touched debt.
   *
   * Returned so the caller can persist exactly what the closure decision was
   * computed from. A caller that saved its own idea of the finding set would be
   * storing something other than what was judged.
   */
  readonly findings?: readonly ReviewFinding[];
  /**
   * Whether the classification this result rests on has ever been checked
   * against the owner's judgement. Never omitted — an absent field reads as
   * "fine", and the honest default here is "nobody has looked".
   */
  readonly calibration?: CalibrationStatus;
  /**
   * Criteria the caller claimed as bare strings, which therefore did not count.
   *
   * Reported by name because the alternative is a caller watching a criterion it
   * "supplied" stay unmet with no explanation — the failure mode of every silent
   * strip.
   */
  readonly unattestedCriteria?: readonly string[];
  /** Attestations that could not be honoured, each with its reason. */
  readonly ignoredAttestations?: readonly IgnoredAttestation[];
  /** Attestations a finding on record contradicts. */
  readonly voidedAttestations?: readonly VoidedAttestation[];
  /**
   * The attestations of record for this stage after merging this round's.
   *
   * Returned for the same reason `findings` is: the caller persists exactly what
   * the closure decision was computed from, not its own idea of it.
   */
  readonly attestations?: readonly StoredAttestation[];
}

function isKnownStage(stage: string): stage is PipelineStageId {
  return (PIPELINE_STAGE_IDS as readonly string[]).includes(stage);
}

function isUnresolvedBlocking(finding: ReviewFinding): boolean {
  return (
    finding.classification === "blocking" &&
    finding.disposition !== "fixed" &&
    finding.disposition !== "refuted"
  );
}

/**
 * Findings for the stage: everything already on record, plus this round's,
 * with debt the change set touches reopened.
 *
 * Prior findings are merged rather than replaced because a clean round does not
 * erase somebody else's open blocker. Closure is over the whole record, which is
 * what stops a stage being closed by whichever reviewer happens to go last.
 */
function mergeFindings(
  prior: readonly ReviewFinding[],
  submitted: readonly ReviewFinding[],
): readonly ReviewFinding[] {
  const byId = new Map<string, ReviewFinding>();
  for (const finding of prior) byId.set(finding.id, finding);
  // This round's version of a finding supersedes the recorded one — that is how
  // a finding gets dispositioned.
  for (const finding of submitted) byId.set(finding.id, finding);
  return [...byId.values()];
}

/**
 * `no-open-debt-in-touched-paths`, from the finding set and the planned writes.
 *
 * This was arriving as a caller-supplied string while the answer sat one line
 * away — the server reopens touched debt from the durable record and the
 * ChangeSet's own envelope `ownedPaths`, and then counts what it reopened.
 * Asking the caller was asking a question already answered better.
 *
 * TWO CONDITIONS, because reopening CLEARS a finding's disposition. Debt reopened
 * by an earlier round is no longer `accepted-debt` and so is invisible to the
 * touched-debt query; it is a blocking finding naming this criterion. Checking
 * only the query would report the criterion met with a finding on record saying
 * it is violated.
 *
 * The query runs on the PRE-reclassification set on purpose: after
 * `reclassifyDebtForWriteSet` has done its work there is by construction no
 * touched `accepted-debt` left to find, so asking afterwards always answers "no
 * debt" — the derivation would be vacuously true exactly when it matters.
 */
function deriveDebtCriterion(
  beforeReclassification: readonly ReviewFinding[],
  afterReclassification: readonly ReviewFinding[],
  plannedWrites: readonly string[],
): readonly string[] {
  const touched = selectDebtTouchedBy(beforeReclassification, plannedWrites);
  const stillOpen = afterReclassification.some(
    (finding) => finding.violates === DEBT_REOPENED_CRITERION && isUnresolvedBlocking(finding),
  );
  return touched.length === 0 && !stillOpen ? [DEBT_REOPENED_CRITERION] : [];
}

interface AttestationResolution {
  readonly met: readonly string[];
  readonly ignored: readonly IgnoredAttestation[];
  readonly voided: readonly VoidedAttestation[];
  readonly ofRecord: readonly StoredAttestation[];
}

/**
 * Which judged criteria an attributed claim actually establishes.
 *
 * Three ways a well-formed claim still fails to count, in the order they are
 * checked:
 *
 *   1. **The server derives this criterion.** Discarded, never honoured: letting a
 *      judgement override evidence is the derivation running backwards. Reported,
 *      because a caller attesting one has misunderstood something worth being
 *      told.
 *   2. **The stage does not require it.** An attestation for another stage's
 *      criterion is a judgement about a different artifact.
 *   3. **A finding on record contradicts it.** This is the one contradiction a tool
 *      can catch without deciding the criterion itself: an unresolved blocking
 *      finding names the criterion in `violates`, so there are two claims about it
 *      and the falsifiable one is unanswered. Closure was already blocked by that
 *      finding — what this fixes is `unmetCriteria` reporting the criterion MET,
 *      which is a report contradicting the record it was computed from.
 */
function resolveAttestations(input: {
  readonly stage: string;
  readonly submitted: readonly StoredAttestation[];
  readonly prior: readonly StoredAttestation[];
  readonly requiredCriteria: readonly string[];
  readonly findings: readonly ReviewFinding[];
}): AttestationResolution {
  const ignored: IgnoredAttestation[] = [];
  const voided: VoidedAttestation[] = [];

  // This round's claim supersedes an earlier round's for the same criterion — a
  // re-assertion is a revision, not a second voice.
  const byCriterion = new Map<string, StoredAttestation>();
  for (const attestation of input.prior) {
    if (attestation.stage !== input.stage) continue;
    byCriterion.set(attestation.criterion, attestation);
  }
  for (const attestation of input.submitted) {
    if (GATE_DERIVED_CRITERIA.includes(attestation.criterion)) {
      ignored.push({
        criterion: attestation.criterion,
        reason: "derived from evidence server-side; an attestation cannot override it",
      });
      continue;
    }
    if (!input.requiredCriteria.includes(attestation.criterion)) {
      ignored.push({
        criterion: attestation.criterion,
        reason: `not an exit criterion of the "${input.stage}" stage`,
      });
      continue;
    }
    byCriterion.set(attestation.criterion, attestation);
  }

  const contradiction = new Map<string, string>();
  for (const finding of input.findings) {
    if (finding.violates === undefined) continue;
    if (!isUnresolvedBlocking(finding)) continue;
    if (!contradiction.has(finding.violates)) contradiction.set(finding.violates, finding.id);
  }

  const met: string[] = [];
  for (const [criterion] of byCriterion) {
    const contradictedBy = contradiction.get(criterion);
    if (contradictedBy !== undefined) {
      voided.push({ criterion, contradictedBy });
      continue;
    }
    met.push(criterion);
  }

  return { met, ignored, voided, ofRecord: [...byCriterion.values()] };
}

export async function runReviewSubmit(
  input: ReviewSubmitInput,
  deps: ReviewSubmitDeps,
): Promise<ReviewSubmitResult> {
  if (!isKnownStage(input.stage)) {
    // Never fall back to "no criteria": an empty requirement list satisfies the
    // closure rule vacuously, so a typo would CLOSE a stage.
    return { ok: false, error: `unknown stage "${input.stage}"` };
  }

  const parsed = ReviewVerdictSchema.safeParse(input.verdict);
  if (!parsed.success) {
    // Not journaled. An invalid document is not a review that happened, and
    // recording it would put something on the audit trail no reviewer stands
    // behind.
    return {
      ok: false,
      error: `invalid review verdict: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    };
  }
  const verdict: ReviewVerdict = parsed.data;

  // Validated before anything is journaled or persisted, and REJECTED rather than
  // dropped: an anonymous or unanchored claim is a caller bug, and accepting the
  // submission while quietly ignoring it would leave the caller believing a
  // criterion was established by something the server threw away.
  const parsedAttestations: CriterionAttestation[] = [];
  for (const candidate of input.attestations ?? []) {
    const result = CriterionAttestationSchema.safeParse(candidate);
    if (!result.success) {
      return {
        ok: false,
        error: `invalid criterion attestation: ${result.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }
    parsedAttestations.push(result.data);
  }

  const prior = deps.priorFindings();
  const merged = mergeFindings(prior, verdict.findings);
  const writes = deps.plannedWrites();
  const afterDebt = reclassifyDebtForWriteSet(merged, writes);
  // Compared by ID, never by index. `reclassifyDebtForWriteSet` happens to
  // preserve order today, and a count that silently depends on that would be
  // wrong the moment it does not — this session has spent several rounds on
  // exactly that class of coupling.
  const dispositionBefore = new Map(merged.map((finding) => [finding.id, finding.disposition]));
  const reopenedDebt = afterDebt.filter(
    (finding) => finding.disposition !== dispositionBefore.get(finding.id),
  ).length;

  const requiredCriteria = exitCriteriaFor(input.stage);

  const attested = resolveAttestations({
    stage: input.stage,
    submitted: parsedAttestations.map((attestation) => ({ ...attestation, stage: input.stage })),
    prior: deps.priorAttestations?.() ?? [],
    requiredCriteria,
    findings: afterDebt,
  });

  /**
   * What a criterion being "met" now rests on, and nothing else:
   *
   *   - the gate criteria, derived by the composition root from journaled evidence
   *     and passed in through `metCriteria` — which is why only the ids in
   *     `GATE_DERIVED_CRITERIA` are taken from there;
   *   - the debt criterion, derived HERE from the finding set and planned writes;
   *   - the judged criteria, each carrying an attributed claim no finding
   *     contradicts.
   *
   * Anything else arriving in `metCriteria` is a judged criterion claimed as a bare
   * string, and an anonymous boolean is the weakest form a claim can take. It
   * counts for nothing and is reported back by name rather than silently dropped.
   */
  const injectedFromEvidence = deps
    .metCriteria()
    .filter((criterion) => GATE_DERIVED_CRITERIA.includes(criterion));
  const unattestedCriteria = deps
    .metCriteria()
    .filter((criterion) => !GATE_DERIVED_CRITERIA.includes(criterion))
    .filter((criterion) => !attested.met.includes(criterion));
  const metCriteria = [
    ...injectedFromEvidence,
    ...deriveDebtCriterion(merged, afterDebt, writes),
    ...attested.met,
  ];
  const stageClosable = isStageClosable({ metCriteria, requiredCriteria, findings: afterDebt });

  const unmetCriteria = requiredCriteria.filter((criterion) => !metCriteria.includes(criterion));
  const openBlocking = afterDebt.filter(isUnresolvedBlocking).length;
  const undispositioned = afterDebt.filter((finding) => finding.disposition === undefined).length;

  /**
   * The progress rule (owner ruling §7.1), derived rather than self-reported.
   *
   * A round earns another round only by closing a blocking finding. The count
   * comes from dispositions in the submitted document, never from the reviewer
   * saying it made progress — a reviewer scoring its own progress is the
   * sycophancy failure Gap 19 was written to exclude, inverted.
   */
  const closedThisRound = verdict.findings.filter(
    (finding) =>
      finding.classification === "blocking" &&
      (finding.disposition === "fixed" || finding.disposition === "refuted"),
  ).length;
  const stalled = !stageClosable && verdict.round > 1 && closedThisRound === 0;
  const atCeiling = !stageClosable && verdict.round >= REVIEW_ROUND_CEILING;
  const escalate = stalled || atCeiling;

  await deps.appendEvidence({
    kind: "review.verdict",
    stage: input.stage,
    lens: verdict.lens,
    round: verdict.round,
    verdict: verdict.verdict,
    findingCount: verdict.findings.length,
    stageClosable,
  });

  return {
    ok: true,
    findings: afterDebt,
    calibration: deps.calibration(),
    attestations: attested.ofRecord,
    unattestedCriteria,
    ignoredAttestations: attested.ignored,
    voidedAttestations: attested.voided,
    stageClosable,
    unmetCriteria,
    openBlocking,
    undispositioned,
    reopenedDebt,
    escalate,
    ...(escalate
      ? {
          escalationReason: atCeiling
            ? `round ${String(verdict.round)} reached the ceiling of ${String(REVIEW_ROUND_CEILING)} without closing the stage — raise irreducible_product_decision`
            : "this round closed no blocking finding — raise irreducible_product_decision rather than looping",
        }
      : {}),
  };
}

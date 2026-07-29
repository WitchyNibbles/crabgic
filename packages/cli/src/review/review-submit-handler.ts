import {
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
} from "@crabgic/contracts";

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
  /** Exit criteria this stage has satisfied, established outside the review. */
  readonly metCriteria: () => readonly string[];
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
  // The debt criterion is DERIVED here and stripped from whatever the caller
  // claimed, for the same reason the gate criteria are: the server already knows
  // the answer, so asking is worse than deciding. Everything else in
  // `metCriteria` is a judgement no tool can settle and passes through.
  const metCriteria = [
    ...deps.metCriteria().filter((criterion) => criterion !== DEBT_REOPENED_CRITERION),
    ...deriveDebtCriterion(merged, afterDebt, writes),
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

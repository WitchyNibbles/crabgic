import type { FindingClassification, ReviewFinding } from "@crabgic/contracts";
import {
  CLASSIFICATION_RUBRIC_VERSION,
  scoreCalibration,
  type CalibrationResult,
  type CalibrationSample,
} from "./calibration.js";

/**
 * `review.calibrate` — the write surface the calibration corpus never had.
 *
 * WHAT WAS ACTUALLY MISSING. `scoreCalibration` and `recordCalibrationSample` both
 * shipped, both tested, and `recordCalibrationSample` was called from nothing but
 * its own test. So the classifier reported `sampleSize: 0` on every single result,
 * forever — not because nobody had done the work, but because there was no way to.
 * `docs/staged-review-pipeline.md` §8.3 recorded "what remains is a corpus" as
 * though it were waiting on the owner. It was waiting on a tool.
 *
 * THE CLASSIFIER'S OWN CALL IS NOT AN INPUT. It is read from the finding on
 * record. Accepting it would let a caller manufacture agreement — twenty samples
 * where "both said advisory" and the classifier certifies itself — which is the
 * reviewer-supplying-its-own-verdict failure one level further out. The owner's
 * call is the only thing this tool takes, because it is the only thing the server
 * cannot know.
 *
 * WHAT THIS DOES NOT CLOSE. The owner speaks through the orchestrator, so a
 * manager could in principle relay a judgement the owner never made. Nothing on
 * this surface can prevent that; what holds is that fabricating agreement requires
 * fabricating the OWNER's label specifically, and the corpus is a plain file in
 * the owner's own state directory that they can read. Recorded here rather than
 * left implied.
 */

/** Suggestions per call. Capped because a list nobody reads is not a suggestion. */
const CANDIDATE_LIMIT = 6;

export interface ReviewCalibrateInput {
  /** The finding the owner is ruling on. Required together with `ownerClassification`. */
  readonly findingId?: string;
  /** What the owner says the classification should have been. */
  readonly ownerClassification?: FindingClassification;
}

export interface ReviewCalibrateDeps {
  /** Findings on record — the source of the classifier's own call. */
  readonly findings: () => readonly ReviewFinding[];
  /** The corpus as it stands. */
  readonly samples: () => readonly CalibrationSample[];
  readonly record: (sample: CalibrationSample) => Promise<void>;
}

export interface CalibrationCandidate {
  readonly findingId: string;
  readonly claim: string;
  /** What the classifier called it — shown so the owner is ruling on a real call. */
  readonly classifier: FindingClassification;
  readonly disposition?: string;
  /** Why this one is worth the owner's attention before the others. */
  readonly why: string;
}

export interface ReviewCalibrateResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly calibration?: CalibrationResult;
  readonly candidates?: readonly CalibrationCandidate[];
  /** The true number of unjudged findings, so a capped list is never read as complete. */
  readonly candidatesTotal?: number;
}

/**
 * Why a finding is worth asking about, and how urgently — lower sorts first.
 *
 * The two disagreement shapes come free from the dispositions already on record.
 * An `advisory` finding somebody fixed anyway is what under-blocking looks like
 * after the fact; a `blocking` finding that got refuted is what over-blocking
 * looks like. Those are the cases near the decision boundary, which is where the
 * active-learning literature says a scarce labelling budget belongs — random
 * sampling spends twenty owner judgements to learn what six could have.
 *
 * They are SUGGESTIONS, never labels. A disposition is evidence about the
 * classifier, not the owner's verdict on it. Promoting one to a sample would have
 * the classifier graded by its own downstream consequences, which is the
 * self-certification this file otherwise refuses.
 */
function candidacy(finding: ReviewFinding): { readonly rank: number; readonly why: string } {
  if (finding.classification === "advisory" && finding.disposition === "fixed") {
    return {
      rank: 0,
      why: "called advisory and then fixed anyway — if it had to be fixed to close the stage, it may have been blocking",
    };
  }
  if (finding.classification === "blocking" && finding.disposition === "refuted") {
    return {
      rank: 0,
      why: "called blocking and then refuted — the classifier may be blocking on findings that should defer",
    };
  }
  return {
    rank: 1,
    why: "not yet judged against the classifier's call under the current rubric",
  };
}

function selectCandidates(
  findings: readonly ReviewFinding[],
  samples: readonly CalibrationSample[],
): { readonly candidates: readonly CalibrationCandidate[]; readonly total: number } {
  // Judged under ANOTHER rubric does not count as judged: that rewrite is exactly
  // what makes the finding worth asking about again.
  const judged = new Set(
    samples
      .filter((sample) => (sample.rubricVersion ?? 1) === CLASSIFICATION_RUBRIC_VERSION)
      .map((sample) => sample.findingId),
  );
  const unjudged = findings.filter((finding) => !judged.has(finding.id));
  const ranked = unjudged
    .map((finding) => ({ finding, ...candidacy(finding) }))
    .sort((left, right) => left.rank - right.rank);

  return {
    total: unjudged.length,
    candidates: ranked.slice(0, CANDIDATE_LIMIT).map(({ finding, why }) => ({
      findingId: finding.id,
      claim: finding.claim,
      classifier: finding.classification,
      ...(finding.disposition !== undefined ? { disposition: finding.disposition } : {}),
      why,
    })),
  };
}

/**
 * Record one owner judgement, or — called with no judgement — report where the
 * corpus stands and which findings are worth asking about next.
 *
 * One tool with two modes rather than two tools, because they are one
 * conversation: the orchestrator asks what is missing, puts those findings to the
 * owner, and records the answers. Splitting them would put a round trip between a
 * question and its answer for no gain.
 */
export async function runReviewCalibrate(
  input: ReviewCalibrateInput,
  deps: ReviewCalibrateDeps,
): Promise<ReviewCalibrateResult> {
  const { findingId, ownerClassification } = input;

  if (findingId === undefined && ownerClassification === undefined) {
    const { candidates, total } = selectCandidates(deps.findings(), deps.samples());
    return {
      ok: true,
      calibration: scoreCalibration(deps.samples()),
      candidates,
      candidatesTotal: total,
    };
  }

  // Half a judgement is not a judgement. Recording one silently, or defaulting the
  // missing half, would put something in the corpus the owner did not say.
  if (findingId === undefined) {
    return { ok: false, error: "a judgement needs the findingId it is about" };
  }
  if (ownerClassification === undefined) {
    return {
      ok: false,
      error: `no ownerClassification given for finding "${findingId}" — the owner's own call is the only thing this tool cannot derive`,
    };
  }

  const finding = deps.findings().find((candidate) => candidate.id === findingId);
  if (finding === undefined) {
    // Never fall back to a classification: a sample whose classifier half was
    // invented measures nothing, and it would be indistinguishable in the corpus
    // from one that measured something.
    return {
      ok: false,
      error: `unknown finding "${findingId}" — a judgement can only be recorded against a finding on record, since that is where the classifier's own call comes from`,
    };
  }

  const sample: CalibrationSample = {
    findingId,
    owner: ownerClassification,
    classifier: finding.classification,
    rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
  };
  await deps.record(sample);

  // Rescored over the corpus INCLUDING what was just recorded. Reporting the
  // state before the call that changed it would be reporting the wrong number at
  // the one moment the caller is watching.
  const corpus = [...deps.samples().filter((entry) => !sameSample(entry, sample)), sample];
  const { candidates, total } = selectCandidates(deps.findings(), corpus);
  return {
    ok: true,
    calibration: scoreCalibration(corpus),
    candidates,
    candidatesTotal: total,
  };
}

/** Same finding, same rubric — a revision, not a second sample. */
function sameSample(left: CalibrationSample, right: CalibrationSample): boolean {
  return (
    left.findingId === right.findingId &&
    (left.rubricVersion ?? 1) === (right.rubricVersion ?? 1)
  );
}

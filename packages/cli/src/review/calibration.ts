import type { FindingClassification } from "@crabgic/contracts";

/**
 * Calibration for the `blocking` / `advisory` split.
 *
 * WHY THIS EXISTS. That split is the judgement the entire staged pipeline rests
 * on: it decides what holds a stage open. Ledger Gap 20 discloses that it is
 * asserted rather than measured, and the literature is blunt that an
 * uncalibrated judge is decorative — a score nobody has checked against a human
 * is a number, not evidence.
 *
 * `docs/staged-review-pipeline.md` §8.3 recorded this as "cannot be closed by
 * writing code". That is half right, and the wrong half stopped work: the DATA
 * needs the owner, since only they can say whether a finding called `advisory`
 * should have blocked. The HARNESS does not — and without it there is nowhere to
 * put their judgement when they give it.
 *
 * KAPPA, NOT RAW AGREEMENT. Raw agreement is inflated by whichever class is
 * common. A classifier that marks everything `advisory` on a corpus that is 90%
 * `advisory` scores 0.9 raw and 0.0 kappa, while being unable to identify a
 * single blocker — the one judgement the pipeline actually depends on. Cohen's
 * kappa subtracts the agreement chance would have produced.
 */

export interface CalibrationSample {
  readonly findingId: string;
  /** What the owner says it should have been. */
  readonly owner: FindingClassification;
  /** What the classifier said. */
  readonly classifier: FindingClassification;
}

/**
 * The kappa a classifier must reach to be trusted.
 *
 * 0.6 is the conventional "acceptable" line: below 0.4 the rubric is treated as
 * ambiguous and in need of rewriting rather than tuning, 0.4-0.6 as weak but
 * tunable. Pinned as a constant so raising it to pass is a visible edit.
 */
export const CALIBRATION_THRESHOLD = 0.6;

/**
 * The smallest corpus that may declare a classifier calibrated.
 *
 * A handful of samples can score 1.0 by luck, and "calibrated on three
 * findings" is the decorative judge the literature warns about wearing a
 * number. Twenty is small for this purpose and is a floor, not a target.
 */
export const CALIBRATION_MINIMUM_SAMPLE = 20;

export interface CalibrationResult {
  readonly kappa: number;
  readonly rawAgreement: number;
  /** Classifier said `blocking`, owner said `advisory` — stalls the pipeline. */
  readonly overBlocking: number;
  /** Classifier said `advisory`, owner said `blocking` — lets defects through. */
  readonly underBlocking: number;
  readonly sampleSize: number;
  readonly insufficientSample: boolean;
  /** Both raters used one class only, so there is no disagreement to explain. */
  readonly degenerate: boolean;
  readonly calibrated: boolean;
  /** How many more samples are needed before a verdict is possible. */
  readonly samplesNeeded: number;
}

/**
 * Score the classifier against the owner's own calls.
 *
 * Reports the two error directions separately, because they are different
 * problems with different fixes: over-blocking stalls the pipeline on findings
 * that should have deferred, under-blocking lets real defects through as
 * advisory. A single number that cannot tell them apart is not actionable.
 */
export function scoreCalibration(samples: readonly CalibrationSample[]): CalibrationResult {
  const total = samples.length;
  const insufficientSample = total < CALIBRATION_MINIMUM_SAMPLE;
  const samplesNeeded = Math.max(0, CALIBRATION_MINIMUM_SAMPLE - total);

  if (total === 0) {
    return {
      kappa: 0,
      rawAgreement: 0,
      overBlocking: 0,
      underBlocking: 0,
      sampleSize: 0,
      insufficientSample: true,
      degenerate: true,
      calibrated: false,
      samplesNeeded,
    };
  }

  const agreed = samples.filter((s) => s.owner === s.classifier).length;
  const rawAgreement = agreed / total;
  const overBlocking = samples.filter(
    (s) => s.classifier === "blocking" && s.owner === "advisory",
  ).length;
  const underBlocking = samples.filter(
    (s) => s.classifier === "advisory" && s.owner === "blocking",
  ).length;

  // Cohen's kappa: (observed - expected) / (1 - expected), where expected is
  // the agreement two raters would reach by chance given their own marginals.
  const ownerBlocking = samples.filter((s) => s.owner === "blocking").length / total;
  const classifierBlocking = samples.filter((s) => s.classifier === "blocking").length / total;
  const expected =
    ownerBlocking * classifierBlocking + (1 - ownerBlocking) * (1 - classifierBlocking);

  // Expected agreement of 1 means both raters used a single class throughout,
  // so the formula divides by zero. That corpus contains no disagreement to
  // explain and therefore cannot demonstrate agreement either — reporting NaN
  // would propagate a non-number into a verdict, so it is called degenerate.
  const degenerate = expected >= 1;
  const kappa = degenerate ? 0 : (rawAgreement - expected) / (1 - expected);

  return {
    kappa,
    rawAgreement,
    overBlocking,
    underBlocking,
    sampleSize: total,
    insufficientSample,
    degenerate,
    calibrated: !degenerate && !insufficientSample && kappa >= CALIBRATION_THRESHOLD,
    samplesNeeded,
  };
}

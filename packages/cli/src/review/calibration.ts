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
 *
 * THE INTERVAL, NOT THE POINT ESTIMATE. Added 2026-07-29 after checking the
 * external record, which is specific: about 50 stratified samples pin kappa to
 * roughly ±0.10-0.15 at 95%, and the variance is dominated by the count of
 * MINORITY-class examples rather than the total. A published measurement of
 * κ = 0.633 carried a 95% interval of [0.433, 0.814] — one number spanning "the
 * rubric is ambiguous" to "the judge is strong". Deciding `calibrated` on the
 * point estimate at twenty samples would therefore have moved the decorative
 * judge rather than removed it, so the verdict is taken on the interval's LOWER
 * BOUND.
 */

export interface CalibrationSample {
  readonly findingId: string;
  /** What the owner says it should have been. */
  readonly owner: FindingClassification;
  /** What the classifier said. */
  readonly classifier: FindingClassification;
  /**
   * The rubric this judgement was made under.
   *
   * Kappa pooled across a rubric change measures two different classifiers. The
   * rubric IS the definition of `blocking` versus `advisory`, so rewriting it —
   * which a kappa below 0.4 is meant to prompt — makes every earlier sample a
   * judgement about a classifier that no longer exists.
   *
   * Optional because the corpus predating the field was gathered under rubric 1
   * by definition; there was only one. Absent therefore reads as 1 rather than
   * being discarded, which would throw away real owner judgements to resolve an
   * ambiguity that does not exist.
   */
  readonly rubricVersion?: number;
}

/**
 * The rubric revision currently in force.
 *
 * Bumped BY HAND when the `blocking`/`advisory` definition changes — in
 * `ReviewFindingSchema`'s classification semantics or the reviewer charter that
 * applies them. Bumping it resets the corpus, which is the honest cost: the
 * alternative is a score that quietly stopped describing the shipped classifier.
 * The reset is visible in `sampleSize` rather than hidden in the kappa.
 */
export const CLASSIFICATION_RUBRIC_VERSION = 1;

/**
 * The kappa a classifier must reach to be trusted.
 *
 * 0.6 is the conventional "acceptable" line: below 0.4 the rubric is treated as
 * ambiguous and in need of rewriting rather than tuning, 0.4-0.6 as weak but
 * tunable. Pinned as a constant so raising it to pass is a visible edit. Applied
 * to the interval's lower bound, not to the estimate.
 */
export const CALIBRATION_THRESHOLD = 0.6;

/**
 * The smallest corpus that may declare a classifier calibrated.
 *
 * This is no longer the main guard — the confidence interval is — but it stays,
 * because the normal approximation the interval rests on is not trustworthy at
 * tiny n at all. Below twenty samples the interval itself is the thing being
 * guessed at, so no verdict is offered however the numbers land.
 */
export const CALIBRATION_MINIMUM_SAMPLE = 20;

/**
 * The smallest number of OWNER-labelled samples required in each class.
 *
 * Kappa's variance is dominated by the minority class, and `blocking` is both the
 * rare call and the only one the pipeline depends on being right. A corpus of
 * sixty samples containing five blockers is large, possibly unanimous, and says
 * nothing about the judgement that matters.
 *
 * Measured on the OWNER's labels, deliberately. The owner's marginal is the
 * ground truth this corpus is stratified against; the classifier's marginal is
 * the thing being measured, and making it a precondition would be requiring the
 * classifier to behave a certain way before agreeing to check whether it does.
 */
export const CALIBRATION_MINIMUM_PER_CLASS = 8;

/** 95% two-sided normal quantile — the interval this module reports. */
const Z_95 = 1.959963984540054;

export interface CalibrationResult {
  readonly kappa: number;
  /**
   * The 95% interval's lower bound, clamped to [-1, kappa].
   *
   * This is what `calibrated` is decided on. Clamped at `kappa` because a
   * standard error of zero (perfect agreement) must not produce a bound above
   * the estimate itself.
   */
  readonly kappaLowerBound: number;
  /**
   * Standard error of kappa, from the first-order normal approximation
   * `Po(1-Po) / (n(1-Pe)^2)`.
   *
   * NAMED LIMIT: this approximation UNDERSTATES variance at small n, so the
   * interval is optimistic exactly where optimism is least warranted. It is used
   * anyway because it is deterministic — a bootstrap would put a random number
   * generator inside a closure decision — and it is fenced on both sides by the
   * absolute sample floor and the minority-class floor rather than trusted alone.
   */
  readonly kappaStandardError: number;
  readonly rawAgreement: number;
  /** Classifier said `blocking`, owner said `advisory` — stalls the pipeline. */
  readonly overBlocking: number;
  /** Classifier said `advisory`, owner said `blocking` — lets defects through. */
  readonly underBlocking: number;
  readonly sampleSize: number;
  /** How many of the scored samples the owner called `blocking`. */
  readonly ownerBlocking: number;
  readonly insufficientSample: boolean;
  readonly insufficientMinorityClass: boolean;
  /** Both raters used one class only, so there is no disagreement to explain. */
  readonly degenerate: boolean;
  readonly calibrated: boolean;
  /** How many more samples are needed before a verdict is possible. */
  readonly samplesNeeded: number;
  /** How many more of the scarcer owner-labelled class are needed. */
  readonly minorityClassNeeded: number;
  /** The rubric these samples were scored under. */
  readonly rubricVersion: number;
  /** Why the verdict came out as it did, in one sentence a person can act on. */
  readonly verdictReason: string;
}

function rubricOf(sample: CalibrationSample): number {
  return sample.rubricVersion ?? 1;
}

/**
 * Score the classifier against the owner's own calls.
 *
 * Reports the two error directions separately, because they are different
 * problems with different fixes: over-blocking stalls the pipeline on findings
 * that should have deferred, under-blocking lets real defects through as
 * advisory. A single number that cannot tell them apart is not actionable.
 *
 * Samples judged under a superseded rubric are excluded rather than pooled — see
 * `CalibrationSample.rubricVersion`.
 */
export function scoreCalibration(all: readonly CalibrationSample[]): CalibrationResult {
  const samples = all.filter((entry) => rubricOf(entry) === CLASSIFICATION_RUBRIC_VERSION);
  const total = samples.length;
  const insufficientSample = total < CALIBRATION_MINIMUM_SAMPLE;
  const samplesNeeded = Math.max(0, CALIBRATION_MINIMUM_SAMPLE - total);

  const ownerBlockingCount = samples.filter((s) => s.owner === "blocking").length;
  const ownerAdvisoryCount = total - ownerBlockingCount;
  const scarcerClass = Math.min(ownerBlockingCount, ownerAdvisoryCount);
  const minorityClassNeeded = Math.max(0, CALIBRATION_MINIMUM_PER_CLASS - scarcerClass);
  const insufficientMinorityClass = minorityClassNeeded > 0;

  if (total === 0) {
    return {
      kappa: 0,
      kappaLowerBound: 0,
      kappaStandardError: 0,
      rawAgreement: 0,
      overBlocking: 0,
      underBlocking: 0,
      sampleSize: 0,
      ownerBlocking: 0,
      insufficientSample: true,
      insufficientMinorityClass: true,
      degenerate: true,
      calibrated: false,
      samplesNeeded,
      minorityClassNeeded,
      rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
      verdictReason:
        `nobody has classified a finding against this classifier yet under rubric ` +
        `${String(CLASSIFICATION_RUBRIC_VERSION)} — its blocking/advisory calls are asserted, not measured`,
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
  const ownerBlocking = ownerBlockingCount / total;
  const classifierBlocking = samples.filter((s) => s.classifier === "blocking").length / total;
  const expected =
    ownerBlocking * classifierBlocking + (1 - ownerBlocking) * (1 - classifierBlocking);

  // Expected agreement of 1 means both raters used a single class throughout,
  // so the formula divides by zero. That corpus contains no disagreement to
  // explain and therefore cannot demonstrate agreement either — reporting NaN
  // would propagate a non-number into a verdict, so it is called degenerate.
  const degenerate = expected >= 1;
  const kappa = degenerate ? 0 : (rawAgreement - expected) / (1 - expected);

  const variance = degenerate
    ? 0
    : (rawAgreement * (1 - rawAgreement)) / (total * (1 - expected) ** 2);
  const kappaStandardError = Math.sqrt(variance);
  // Clamped at `kappa` so perfect agreement (standard error zero) cannot report a
  // bound above its own estimate, and at -1 so the bound stays inside kappa's range.
  const kappaLowerBound = Math.max(-1, Math.min(kappa, kappa - Z_95 * kappaStandardError));

  const calibrated =
    !degenerate &&
    !insufficientSample &&
    !insufficientMinorityClass &&
    kappaLowerBound >= CALIBRATION_THRESHOLD;

  return {
    kappa,
    kappaLowerBound,
    kappaStandardError,
    rawAgreement,
    overBlocking,
    underBlocking,
    sampleSize: total,
    ownerBlocking: ownerBlockingCount,
    insufficientSample,
    insufficientMinorityClass,
    degenerate,
    calibrated,
    samplesNeeded,
    minorityClassNeeded,
    rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
    verdictReason: describeVerdict({
      calibrated,
      degenerate,
      insufficientSample,
      insufficientMinorityClass,
      samplesNeeded,
      minorityClassNeeded,
      kappa,
      kappaLowerBound,
    }),
  };
}

/**
 * One sentence naming what is missing, in the order it has to be fixed.
 *
 * Reported rather than left for a consumer to reconstruct from six booleans,
 * because the whole point of this module is that a consumer acting on a
 * blocking/advisory verdict deserves to know what backs it — and "calibrated:
 * false" without a reason is the caveat it was built to replace.
 */
function describeVerdict(input: {
  readonly calibrated: boolean;
  readonly degenerate: boolean;
  readonly insufficientSample: boolean;
  readonly insufficientMinorityClass: boolean;
  readonly samplesNeeded: number;
  readonly minorityClassNeeded: number;
  readonly kappa: number;
  readonly kappaLowerBound: number;
}): string {
  const round = (value: number): string => value.toFixed(2);
  if (input.calibrated) {
    return `calibrated: kappa ${round(input.kappa)}, 95% lower bound ${round(
      input.kappaLowerBound,
    )}, at or above the ${String(CALIBRATION_THRESHOLD)} threshold`;
  }
  if (input.degenerate) {
    return "both raters used a single class throughout, so this corpus contains no disagreement to explain and cannot demonstrate agreement either";
  }
  if (input.insufficientSample) {
    return `${String(input.samplesNeeded)} more classified findings needed before any verdict is meaningful (${String(
      CALIBRATION_MINIMUM_SAMPLE,
    )} minimum — below that the confidence interval is itself a guess)`;
  }
  if (input.insufficientMinorityClass) {
    return `${String(
      input.minorityClassNeeded,
    )} more findings needed in the scarcer class the owner labelled — kappa's variance is dominated by it, and a blocking call the corpus barely contains is the one the pipeline most depends on`;
  }
  return `kappa ${round(input.kappa)} but its 95% confidence interval reaches down to ${round(
    input.kappaLowerBound,
  )}, below the ${String(CALIBRATION_THRESHOLD)} threshold — the estimate is not yet distinguishable from an unusable one`;
}

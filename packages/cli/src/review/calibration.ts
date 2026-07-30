import type { FindingClassification } from "@crabgic/contracts";
import { exactLowerBound } from "./binomial-bounds.js";

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
  /**
   * HOW this sample came to be labelled — and therefore whether it may score
   * the gate (2026-07-30).
   *
   * `review.calibrate` deliberately puts the owner in front of the findings a
   * misclassification most likely left behind: an advisory that got fixed
   * anyway, a blocking that got refuted. That is excellent triage and a biased
   * sample. Kappa computed over an error-enriched pool is biased DOWN, so a
   * targeted corpus makes an already-strict gate unpassable while looking like
   * diligence — and actively-selected evaluation items bias metrics unless the
   * selection is corrected for.
   *
   * So the gate scores the `random` slice only. Targeted samples still earn
   * their keep as rubric diagnostics and few-shot exemplars; they simply do not
   * get to decide whether the classifier is trusted.
   *
   * Absent reads as `disposition`, not `random`: every sample gathered before
   * this field existed came from the targeted path, and defaulting the other way
   * would silently admit a biased corpus to the gate.
   */
  readonly samplingSource?: CalibrationSamplingSource;
}

/**
 * Why a sample is in the corpus.
 *
 * - `random` — drawn uniformly from the findings the classifier judged. The only
 *   slice the gate scores.
 * - `disposition` — chosen because its disposition contradicts its
 *   classification (the two shapes a misclassification leaves).
 * - `low_confidence` — chosen because a judge panel did not agree, which is
 *   disagreement sampling and every bit as non-random.
 */
export type CalibrationSamplingSource = "random" | "disposition" | "low_confidence";

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
 * The smallest number of OWNER-labelled samples required in each class before
 * kappa is reported at all.
 *
 * DELIBERATELY LEFT AT 8, and it is worth saying why, because the obvious
 * reading of the recall analysis is that it should be 15. A perfect 8-of-8
 * blocking corpus bounds recall at 0.688, so 8 cannot support a "catches 70% of
 * blockers" claim — but that claim belongs to the `calibrated` tier, which
 * demands 20 blocking labels precisely for this reason
 * (`CALIBRATION_BLOCKING_FOR_CALIBRATED`). This floor guards something smaller:
 * whether kappa is worth printing. Raising it here would have made `provisional`
 * need 30 samples rather than the 20 it advertises, moving a screen's cost onto
 * the screen instead of onto the certification.
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

/**
 * The corpus a `calibrated` verdict needs, and the blocking labels within it.
 *
 * WHY 20 WAS NEVER ENOUGH (2026-07-30). An exhaustive enumeration of the old
 * gate — n=20, 8/12 split, kappa lower bound >= 0.6 — found that exactly THREE
 * of 117 reachable tables pass, all of them at 19/20 or 20/20 agreement. It was
 * "at least 95% raw agreement" wearing a confidence interval's clothes: a
 * genuinely good classifier (true kappa 0.79) passed 39% of the time, and a
 * mediocre one 7%, so the verdict was mostly a coin toss on sampling luck.
 * Published sample-size tables want n≈93–119 to separate kappa 0.4 from 0.6 at
 * 80% power; n=20 is an order of magnitude short of the decision it was asked to
 * make.
 *
 * 50 with at least 20 blocking labels is where the per-class recall bounds below
 * start being able to support the claim the pipeline depends on.
 */
export const CALIBRATION_SAMPLE_FOR_CALIBRATED = 50;
export const CALIBRATION_BLOCKING_FOR_CALIBRATED = 20;

/** The corpus the ORIGINAL kappa threshold becomes a live, passable gate at, rather than a lottery. */
export const CALIBRATION_SAMPLE_FOR_STRONG = 100;

/**
 * The recall each class must demonstrably reach, as an exact one-sided 95% lower
 * bound (`./binomial-bounds.ts`).
 *
 * PER-CLASS AND NOT KAPPA, because kappa does not transfer. The same classifier
 * scores kappa 0.79 on a 40%-blocking corpus and 0.59 at a 10% production
 * blocking rate — below the threshold, with no change to the classifier at all —
 * because kappa is prevalence-dependent and the corpus is deliberately
 * stratified. Sensitivity and specificity are prevalence-INVARIANT, so a bound
 * measured on the corpus still means something in production. Kappa is retained
 * as a secondary drift diagnostic, which is the one thing it adds: it detects
 * the classifier's positive rate drifting away from the owner's.
 *
 * 0.7 is also the point where the floors above stop being decorative: a PERFECT
 * 8-of-8 blocking corpus bounds recall at only 0.688, so under the old
 * minority-class floor a "catches at least 70% of blockers" claim was
 * unprovable no matter how well the classifier did.
 */
export const CALIBRATION_RECALL_FLOOR = 0.7;
export const CALIBRATION_RECALL_FLOOR_STRONG = 0.75;

/** The kappa lower bound a `provisional` or `calibrated` verdict needs — weaker than `CALIBRATION_THRESHOLD`, which is reserved for `strongly-calibrated`. */
export const CALIBRATION_KAPPA_LOWER_BOUND_FLOOR = 0.4;

/**
 * How trusted the classifier is, in four steps rather than a boolean.
 *
 * A boolean forced one threshold to serve two jobs — screening out a decorative
 * judge, and certifying one good enough to close a stage — and the threshold
 * that does the second makes the first unreachable. Naming the tiers lets each
 * be set where it works, and lets the report say which one it is instead of
 * "false" with a paragraph of caveats.
 */
export type CalibrationTier = "uncalibrated" | "provisional" | "calibrated" | "strongly-calibrated";

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
  /** How many labels exist under the current rubric, targeted ones included. */
  readonly sampleSize: number;
  /** How many of the scored samples the owner called `blocking`. */
  readonly ownerBlocking: number;
  readonly insufficientSample: boolean;
  readonly insufficientMinorityClass: boolean;
  /** Both raters used one class only, so there is no disagreement to explain. */
  readonly degenerate: boolean;
  /**
   * `calibrated` is now "the tier is good enough to close a stage", kept so
   * existing consumers keep working; `tier` is the thing to read.
   */
  readonly calibrated: boolean;
  readonly tier: CalibrationTier;
  /**
   * Exact one-sided 95% lower bound on the classifier's recall for each class —
   * the prevalence-invariant numbers a production claim can rest on.
   *
   * `blockingRecallLowerBound` is "of the findings the owner called blocking, at
   * least this fraction were caught". That is the number the pipeline depends on
   * being right, and the one kappa cannot deliver across a prevalence change.
   */
  readonly blockingRecallLowerBound: number;
  readonly advisoryRecallLowerBound: number;
  /** Point estimates the bounds above are drawn from, for a report that shows its work. */
  readonly blockingRecall: number;
  readonly advisoryRecall: number;
  /**
   * How many samples the gate actually scored, versus how many exist.
   *
   * These differ whenever the corpus holds targeted samples, which do not score
   * (see `CalibrationSample.samplingSource`). Reported separately so "20 labels
   * and still uncalibrated" is legible rather than baffling.
   */
  readonly randomSampleSize: number;
  readonly excludedNonRandom: number;
  /** How many more samples are needed before a verdict is possible. */
  readonly samplesNeeded: number;
  /** How many more of the scarcer owner-labelled class are needed. */
  readonly minorityClassNeeded: number;
  /** The rubric these samples were scored under. */
  readonly rubricVersion: number;
  /** Why the verdict came out as it did, in one sentence a person can act on. */
  readonly verdictReason: string;
  /**
   * Projects the share of `blocking` calls that would be RIGHT at a given
   * production blocking rate — the number an owner actually feels, and the one
   * the corpus cannot report on its own because it is deliberately stratified.
   *
   * `PPV = prev*Se / (prev*Se + (1-prev)*(1-Sp))`, from the point estimates. A
   * classifier at 0.90 sensitivity and 0.90 specificity looks strong on a
   * 40%-blocking corpus (PPV 0.86) and produces one false alarm for every real
   * blocker at a 10% production rate (PPV 0.50). Same classifier, and the
   * difference is prevalence.
   *
   * Returns `undefined` when either class has no scored samples, because a
   * projection from a rate nothing measured is a guess with a decimal point.
   */
  readonly projectedPrecisionAt: (productionBlockingRate: number) => number | undefined;
}

function rubricOf(sample: CalibrationSample): number {
  return sample.rubricVersion ?? 1;
}

/** Absent provenance reads as `disposition`: every pre-field sample came from the targeted path, and the other default would admit a biased corpus to the gate. */
function sourceOf(sample: CalibrationSample): CalibrationSamplingSource {
  return sample.samplingSource ?? "disposition";
}

/** Never-`undefined` projection helper for the empty case, so the field's type stays honest without a null check at every call site. */
const NO_PROJECTION = (): number | undefined => undefined;

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
  const currentRubric = all.filter((entry) => rubricOf(entry) === CLASSIFICATION_RUBRIC_VERSION);
  // The gate scores the RANDOM slice only — see `CalibrationSample.samplingSource`
  // for why a targeted corpus biases kappa down and must not decide the verdict.
  const samples = currentRubric.filter((entry) => sourceOf(entry) === "random");
  const excludedNonRandom = currentRubric.length - samples.length;
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
      sampleSize: currentRubric.length,
      ownerBlocking: 0,
      insufficientSample: true,
      insufficientMinorityClass: true,
      degenerate: true,
      calibrated: false,
      tier: "uncalibrated",
      blockingRecallLowerBound: 0,
      advisoryRecallLowerBound: 0,
      blockingRecall: 0,
      advisoryRecall: 0,
      randomSampleSize: 0,
      excludedNonRandom,
      projectedPrecisionAt: NO_PROJECTION,
      samplesNeeded,
      minorityClassNeeded,
      rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
      verdictReason:
        excludedNonRandom > 0
          ? // Labels EXIST; none of them score. Saying "nobody has classified
            // anything" here would be false and would send the owner to do work
            // they have already done.
            `${String(excludedNonRandom)} label(s) recorded under rubric ${String(
              CLASSIFICATION_RUBRIC_VERSION,
            )}, but none were uniformly drawn, so none score — a corpus selected for likely misclassifications biases kappa down, so the gate needs randomly-sampled findings before it can report anything`
          : `nobody has classified a finding against this classifier yet under rubric ` +
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

  // PER-CLASS RECALL, with exact bounds. These are the prevalence-invariant
  // numbers a production claim can rest on, unlike kappa — see
  // `CALIBRATION_RECALL_FLOOR`.
  const blockingCaught = samples.filter(
    (sample) => sample.owner === "blocking" && sample.classifier === "blocking",
  ).length;
  const advisoryCaught = samples.filter(
    (sample) => sample.owner === "advisory" && sample.classifier === "advisory",
  ).length;
  const blockingRecall = ownerBlockingCount === 0 ? 0 : blockingCaught / ownerBlockingCount;
  const advisoryRecall = ownerAdvisoryCount === 0 ? 0 : advisoryCaught / ownerAdvisoryCount;
  const blockingRecallLowerBound = exactLowerBound(blockingCaught, ownerBlockingCount);
  const advisoryRecallLowerBound = exactLowerBound(advisoryCaught, ownerAdvisoryCount);

  // TIERS. Each floor is set where it can actually be met by a classifier that
  // deserves to meet it, instead of one threshold serving two incompatible jobs.
  const kappaFloorMet = !degenerate && kappaLowerBound >= CALIBRATION_KAPPA_LOWER_BOUND_FLOOR;
  const recallsMet = (floor: number): boolean =>
    blockingRecallLowerBound >= floor && advisoryRecallLowerBound >= floor;

  const provisionalReached =
    !degenerate &&
    !insufficientSample &&
    !insufficientMinorityClass &&
    kappa >= CALIBRATION_THRESHOLD &&
    kappaFloorMet;

  const calibratedReached =
    provisionalReached &&
    total >= CALIBRATION_SAMPLE_FOR_CALIBRATED &&
    ownerBlockingCount >= CALIBRATION_BLOCKING_FOR_CALIBRATED &&
    recallsMet(CALIBRATION_RECALL_FLOOR);
  const stronglyReached =
    calibratedReached &&
    total >= CALIBRATION_SAMPLE_FOR_STRONG &&
    recallsMet(CALIBRATION_RECALL_FLOOR_STRONG) &&
    kappaLowerBound >= CALIBRATION_THRESHOLD;

  const tier: CalibrationTier = stronglyReached
    ? "strongly-calibrated"
    : calibratedReached
      ? "calibrated"
      : provisionalReached
        ? "provisional"
        : "uncalibrated";

  // `provisional` is a screen, not a certification: it says "this is not a
  // decorative judge", and deliberately does NOT clear a stage.
  const calibrated = tier === "calibrated" || tier === "strongly-calibrated";

  const sensitivity = blockingRecall;
  const specificity = advisoryRecall;
  const projectedPrecisionAt =
    ownerBlockingCount === 0 || ownerAdvisoryCount === 0
      ? NO_PROJECTION
      : (rate: number): number | undefined => {
          if (!(rate > 0) || !(rate < 1)) return undefined;
          const truePositives = rate * sensitivity;
          const falsePositives = (1 - rate) * (1 - specificity);
          const denominator = truePositives + falsePositives;
          return denominator === 0 ? undefined : truePositives / denominator;
        };

  return {
    kappa,
    kappaLowerBound,
    kappaStandardError,
    rawAgreement,
    overBlocking,
    underBlocking,
    // `sampleSize` keeps its original meaning — how many labels EXIST under the
    // current rubric — so a consumer reading it still learns what it always did.
    // `randomSampleSize` is the slice that scores. Silently redefining the older
    // field would have moved every existing reader onto a different number.
    sampleSize: currentRubric.length,
    ownerBlocking: ownerBlockingCount,
    insufficientSample,
    insufficientMinorityClass,
    degenerate,
    calibrated,
    tier,
    blockingRecallLowerBound,
    advisoryRecallLowerBound,
    blockingRecall,
    advisoryRecall,
    randomSampleSize: total,
    excludedNonRandom,
    projectedPrecisionAt,
    samplesNeeded,
    minorityClassNeeded,
    rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
    verdictReason: describeVerdict({
      calibrated,
      tier,
      total,
      ownerBlockingCount,
      blockingRecallLowerBound,
      advisoryRecallLowerBound,
      excludedNonRandom,
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
  readonly tier: CalibrationTier;
  readonly total: number;
  readonly ownerBlockingCount: number;
  readonly blockingRecallLowerBound: number;
  readonly advisoryRecallLowerBound: number;
  readonly excludedNonRandom: number;
  readonly degenerate: boolean;
  readonly insufficientSample: boolean;
  readonly insufficientMinorityClass: boolean;
  readonly samplesNeeded: number;
  readonly minorityClassNeeded: number;
  readonly kappa: number;
  readonly kappaLowerBound: number;
}): string {
  const round = (value: number): string => value.toFixed(2);
  const excluded =
    input.excludedNonRandom > 0
      ? ` (${String(input.excludedNonRandom)} targeted sample(s) held out of scoring — only uniformly-drawn ones score)`
      : "";

  if (input.tier === "strongly-calibrated") {
    return `strongly calibrated on ${String(input.total)} random samples: blocking recall at or above ${round(
      input.blockingRecallLowerBound,
    )}, advisory recall at or above ${round(input.advisoryRecallLowerBound)}, kappa lower bound ${round(
      input.kappaLowerBound,
    )}${excluded}`;
  }
  if (input.tier === "calibrated") {
    return `calibrated on ${String(input.total)} random samples: blocking recall at or above ${round(
      input.blockingRecallLowerBound,
    )} and advisory recall at or above ${round(
      input.advisoryRecallLowerBound,
    )} — both prevalence-invariant, so they still hold at production blocking rates${excluded}`;
  }
  if (input.degenerate) {
    return "both raters used a single class throughout, so this corpus contains no disagreement to explain and cannot demonstrate agreement either";
  }
  if (input.insufficientSample) {
    return `${String(input.samplesNeeded)} more randomly-drawn classified findings needed before any verdict is meaningful (${String(
      CALIBRATION_MINIMUM_SAMPLE,
    )} minimum — below that the confidence interval is itself a guess)${excluded}`;
  }
  if (input.insufficientMinorityClass) {
    return `${String(
      input.minorityClassNeeded,
    )} more findings needed in the scarcer class the owner labelled — kappa's variance is dominated by it, and a blocking call the corpus barely contains is the one the pipeline most depends on${excluded}`;
  }
  if (input.tier === "provisional") {
    // Say what it is NOT, because "provisional" reads like a mild pass and is
    // not one: it screens out a decorative judge and clears no stage.
    const needSamples = Math.max(0, CALIBRATION_SAMPLE_FOR_CALIBRATED - input.total);
    const needBlocking = Math.max(
      0,
      CALIBRATION_BLOCKING_FOR_CALIBRATED - input.ownerBlockingCount,
    );
    const shortfall: string[] = [];
    if (needSamples > 0) shortfall.push(`${String(needSamples)} more random sample(s)`);
    if (needBlocking > 0) shortfall.push(`${String(needBlocking)} more blocking label(s)`);
    if (input.blockingRecallLowerBound < CALIBRATION_RECALL_FLOOR) {
      shortfall.push(
        `blocking recall proven only to ${round(input.blockingRecallLowerBound)}, not ${String(CALIBRATION_RECALL_FLOOR)}`,
      );
    }
    if (input.advisoryRecallLowerBound < CALIBRATION_RECALL_FLOOR) {
      shortfall.push(
        `advisory recall proven only to ${round(input.advisoryRecallLowerBound)}, not ${String(CALIBRATION_RECALL_FLOOR)}`,
      );
    }
    return `provisional only — kappa ${round(
      input.kappa,
    )} clears the screen, but this does NOT close a stage. Still needed: ${
      shortfall.length > 0 ? shortfall.join("; ") : "nothing"
    }${excluded}`;
  }
  return `kappa ${round(input.kappa)} with a 95% lower bound of ${round(
    input.kappaLowerBound,
  )}, under the ${String(
    CALIBRATION_KAPPA_LOWER_BOUND_FLOOR,
  )} floor a provisional verdict needs — the estimate is not yet distinguishable from an unusable one${excluded}`;
}

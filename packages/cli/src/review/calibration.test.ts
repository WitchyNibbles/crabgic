import { describe, expect, it } from "vitest";
import type { FindingClassification } from "@crabgic/contracts";
import {
  CALIBRATION_MINIMUM_PER_CLASS,
  CALIBRATION_MINIMUM_SAMPLE,
  CALIBRATION_THRESHOLD,
  CLASSIFICATION_RUBRIC_VERSION,
  scoreCalibration,
  type CalibrationSample,
} from "./calibration.js";

/**
 * Calibration — the item `docs/staged-review-pipeline.md` §8.3 records as the
 * one thing that cannot be closed by writing code.
 *
 * That is half true, and the half I got wrong is the half that stopped work.
 * The DATA needs the owner: only they can say whether a finding the classifier
 * called `advisory` should have blocked. The HARNESS does not — and without it
 * there is nowhere to put their judgement when they give it.
 *
 * The literature is blunt that an uncalibrated judge is decorative, and that
 * agreement is measured with Cohen's kappa rather than raw agreement, because
 * raw agreement is inflated by whichever class happens to be common. A
 * classifier that marks everything `advisory` on a corpus that is 90%
 * `advisory` scores 0.9 raw and 0.0 kappa; only one of those numbers is honest.
 */

function sample(
  owner: FindingClassification,
  classifier: FindingClassification,
): CalibrationSample {
  return {
    findingId: `${owner}-${classifier}-${Math.random().toString(36).slice(2)}`,
    owner,
    classifier,
  };
}

function corpus(counts: {
  bb: number;
  ba: number;
  ab: number;
  aa: number;
}): readonly CalibrationSample[] {
  return [
    ...Array.from({ length: counts.bb }, () => sample("blocking", "blocking")),
    ...Array.from({ length: counts.ba }, () => sample("blocking", "advisory")),
    ...Array.from({ length: counts.ab }, () => sample("advisory", "blocking")),
    ...Array.from({ length: counts.aa }, () => sample("advisory", "advisory")),
  ];
}

describe("scoreCalibration — agreement that cannot be faked by the common class", () => {
  it("scores perfect agreement as kappa 1", () => {
    const result = scoreCalibration(corpus({ bb: 10, ba: 0, ab: 0, aa: 10 }));
    expect(result.kappa).toBeCloseTo(1, 5);
    expect(result.calibrated).toBe(true);
  });

  it("scores a classifier that always says `advisory` as kappa 0, not as 90% right", () => {
    // The failure the whole metric exists to catch. Raw agreement here is 0.9
    // and the classifier has learned nothing -- it cannot identify a single
    // blocker, which is the only judgement the pipeline actually depends on.
    const result = scoreCalibration(corpus({ bb: 0, ba: 10, ab: 0, aa: 90 }));
    expect(result.rawAgreement).toBeCloseTo(0.9, 5);
    expect(result.kappa).toBeCloseTo(0, 5);
    expect(result.calibrated).toBe(false);
  });

  it("reports which direction the classifier errs in", () => {
    // Over- and under-blocking are different problems with different fixes:
    // one stalls the pipeline, the other lets defects through. A single score
    // that cannot tell them apart tells the owner nothing actionable.
    const tooEager = scoreCalibration(corpus({ bb: 5, ba: 0, ab: 15, aa: 5 }));
    expect(tooEager.overBlocking).toBe(15);
    expect(tooEager.underBlocking).toBe(0);

    const tooLax = scoreCalibration(corpus({ bb: 5, ba: 15, ab: 0, aa: 5 }));
    expect(tooLax.underBlocking).toBe(15);
    expect(tooLax.overBlocking).toBe(0);
  });

  it("is NOT calibrated below the agreed threshold", () => {
    const result = scoreCalibration(corpus({ bb: 6, ba: 4, ab: 4, aa: 6 }));
    expect(result.kappa).toBeLessThan(CALIBRATION_THRESHOLD);
    expect(result.calibrated).toBe(false);
  });

  /**
   * The property that keeps this honest rather than reassuring: a tiny corpus
   * can score kappa 1.0 by luck. Declaring the classifier calibrated on three
   * samples would be exactly the decorative judge the literature warns about,
   * wearing a number.
   */
  it("refuses to call a classifier calibrated on too small a sample, however well it scored", () => {
    const perfectButTiny = scoreCalibration(corpus({ bb: 1, ba: 0, ab: 0, aa: 1 }));
    expect(perfectButTiny.kappa).toBeCloseTo(1, 5);
    expect(perfectButTiny.calibrated).toBe(false);
    expect(perfectButTiny.insufficientSample).toBe(true);
  });

  it("names how many more samples are needed, so the gap is actionable", () => {
    const result = scoreCalibration(corpus({ bb: 2, ba: 0, ab: 0, aa: 2 }));
    expect(result.samplesNeeded).toBe(CALIBRATION_MINIMUM_SAMPLE - 4);
  });

  it("treats an empty corpus as uncalibrated rather than dividing by zero", () => {
    const result = scoreCalibration([]);
    expect(result.calibrated).toBe(false);
    expect(Number.isNaN(result.kappa)).toBe(false);
  });

  it("handles a corpus where both raters always agree on ONE class", () => {
    // Degenerate: expected agreement is 1, so kappa is undefined by the
    // formula. Reporting NaN would propagate into a verdict; this reports the
    // honest thing, which is that a corpus with no disagreement to explain
    // cannot demonstrate agreement either.
    const result = scoreCalibration(corpus({ bb: 0, ba: 0, ab: 0, aa: 30 }));
    expect(Number.isNaN(result.kappa)).toBe(false);
    expect(result.calibrated).toBe(false);
    expect(result.degenerate).toBe(true);
  });
});

/**
 * A POINT ESTIMATE IS NOT A MEASUREMENT.
 *
 * The external record on calibrating a judge against human labels is specific
 * about this: roughly 50 stratified samples pin Cohen's kappa to about ±0.10-0.15
 * at 95%, and the variance is dominated by the count of MINORITY-class examples
 * rather than the total. A published example measured κ = 0.633 with a 95%
 * bootstrap CI of [0.433, 0.814] — one number, spanning "the rubric is ambiguous"
 * to "the judge is strong".
 *
 * So the same kappa that clears the threshold on 100 samples must not clear it on
 * 20, and `calibrated` is decided on the CI's LOWER BOUND. Anything else reports
 * a coin flip wearing a number, which is the exact failure this module was built
 * to stop rather than to relocate.
 */
describe("scoreCalibration — the interval, not the point estimate", () => {
  it("refuses a strong-looking kappa whose interval reaches below the threshold", () => {
    // 18 of 20 agreed, evenly split by class: kappa 0.8, conventionally "strong".
    const result = scoreCalibration(corpus({ bb: 9, ba: 1, ab: 1, aa: 9 }));
    expect(result.kappa).toBeCloseTo(0.8, 5);
    expect(result.kappaLowerBound).toBeLessThan(CALIBRATION_THRESHOLD);
    expect(result.calibrated).toBe(false);
  });

  it("accepts the SAME agreement rate once there is enough of it", () => {
    // Identical 90% agreement and identical marginals, five times the evidence.
    const result = scoreCalibration(corpus({ bb: 45, ba: 5, ab: 5, aa: 45 }));
    expect(result.kappa).toBeCloseTo(0.8, 5);
    expect(result.kappaLowerBound).toBeGreaterThanOrEqual(CALIBRATION_THRESHOLD);
    expect(result.calibrated).toBe(true);
  });

  it("never reports a lower bound above the estimate itself", () => {
    const result = scoreCalibration(corpus({ bb: 20, ba: 3, ab: 2, aa: 25 }));
    expect(result.kappaLowerBound).toBeLessThanOrEqual(result.kappa);
  });

  /**
   * The minority-class floor. A corpus can be large, unanimous, and still say
   * nothing about the judgement that matters: `blocking` is the rare call and the
   * only one the pipeline depends on being right.
   */
  it("refuses a large corpus that barely contains the minority class", () => {
    const result = scoreCalibration(corpus({ bb: 5, ba: 0, ab: 0, aa: 55 }));
    expect(result.kappa).toBeCloseTo(1, 5);
    expect(result.insufficientSample).toBe(false);
    expect(result.insufficientMinorityClass).toBe(true);
    expect(result.calibrated).toBe(false);
    expect(result.minorityClassNeeded).toBe(CALIBRATION_MINIMUM_PER_CLASS - 5);
  });

  it("says why it withheld the verdict, so the gap is actionable rather than mysterious", () => {
    expect(scoreCalibration([]).verdictReason).toMatch(/no.*sample|nobody/i);
    expect(scoreCalibration(corpus({ bb: 5, ba: 0, ab: 0, aa: 55 })).verdictReason).toMatch(
      /blocking/i,
    );
    expect(scoreCalibration(corpus({ bb: 9, ba: 1, ab: 1, aa: 9 })).verdictReason).toMatch(
      /interval|confidence/i,
    );
    expect(scoreCalibration(corpus({ bb: 45, ba: 5, ab: 5, aa: 45 })).verdictReason).toMatch(
      /calibrated/i,
    );
  });
});

/**
 * KAPPA ACROSS A RUBRIC CHANGE MEASURES TWO DIFFERENT CLASSIFIERS.
 *
 * The rubric is the definition of `blocking` versus `advisory`. Rewrite it — which
 * is exactly what a kappa below 0.4 is supposed to prompt — and every sample
 * gathered under the old wording is a judgement about a classifier that no longer
 * exists. Pooling them produces a number for something nobody shipped.
 *
 * So samples carry the rubric they were judged under, and scoring covers the
 * current one only. The cost is real and is the right cost: rewriting the rubric
 * resets the corpus, which is visible in `sampleSize` rather than hidden in a
 * score that quietly stopped meaning anything.
 */
describe("scoreCalibration — samples are scoped to the rubric they judged", () => {
  function underRubric(
    samples: readonly CalibrationSample[],
    rubricVersion: number,
  ): readonly CalibrationSample[] {
    return samples.map((entry) => ({ ...entry, rubricVersion }));
  }

  it("ignores samples judged under a rubric other than the one in force", () => {
    const stale = underRubric(
      corpus({ bb: 45, ba: 5, ab: 5, aa: 45 }),
      CLASSIFICATION_RUBRIC_VERSION + 1,
    );
    const result = scoreCalibration(stale);
    expect(result.sampleSize).toBe(0);
    expect(result.calibrated).toBe(false);
  });

  it("scores only the current rubric's samples when both are present", () => {
    const current = corpus({ bb: 10, ba: 0, ab: 0, aa: 10 });
    const stale = underRubric(
      corpus({ bb: 0, ba: 50, ab: 50, aa: 0 }),
      CLASSIFICATION_RUBRIC_VERSION + 1,
    );
    const result = scoreCalibration([...current, ...stale]);
    expect(result.sampleSize).toBe(20);
    // The stale half is total disagreement; pooling would have buried the signal.
    expect(result.kappa).toBeCloseTo(1, 5);
  });

  it("treats a sample with no recorded rubric as belonging to the first one", () => {
    // The corpus predating the field was gathered under rubric 1 by definition —
    // there was only one. Dropping those samples would discard real owner
    // judgements to avoid an ambiguity that does not exist.
    const result = scoreCalibration(corpus({ bb: 10, ba: 0, ab: 0, aa: 10 }));
    expect(result.sampleSize).toBe(20);
  });
});

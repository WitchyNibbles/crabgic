import { describe, expect, it } from "vitest";
import type { FindingClassification } from "@crabgic/contracts";
import {
  CALIBRATION_MINIMUM_SAMPLE,
  CALIBRATION_THRESHOLD,
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

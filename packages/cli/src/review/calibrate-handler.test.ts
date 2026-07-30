import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@crabgic/contracts";
import { runReviewCalibrate, type ReviewCalibrateDeps } from "./calibrate-handler.js";
import { CLASSIFICATION_RUBRIC_VERSION, type CalibrationSample } from "./calibration.js";

/**
 * `review.calibrate` — the write surface the corpus never had.
 *
 * `scoreCalibration` and `recordCalibrationSample` both shipped, both tested, and
 * `recordCalibrationSample` was called from NOTHING but its own test. The
 * classifier therefore reported `sampleSize: 0` on every result forever, not
 * because nobody had done the work but because there was no way to. A corpus that
 * cannot be filled is not an empty corpus; it is an uncalibratable classifier
 * wearing an honest-looking number.
 *
 * THE CLASSIFIER'S CALL IS NOT AN INPUT. It is read from the finding on record.
 * Accepting it would let a caller manufacture agreement — record twenty samples
 * where owner and classifier "both said advisory" and the classifier certifies
 * itself. That is the same failure as a reviewer supplying its own verdict, one
 * level further out, and it is the failure this whole module exists to prevent.
 */

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "f-1",
    claim: "the state path is not checked for a symlinked component",
    evidence: { reproduction: "ln -s", observed: "followed", expected: "refused" },
    verification: "confirmed",
    classification: "advisory",
    paths: ["packages/cli/src/doctor"],
    ...overrides,
  } as ReviewFinding;
}

function deps(overrides: Partial<ReviewCalibrateDeps> = {}): ReviewCalibrateDeps {
  const recorded: CalibrationSample[] = [];
  return {
    findings: () => [],
    samples: () => [],
    record: (sample) => {
      recorded.push(sample);
      return Promise.resolve();
    },
    ...overrides,
    ...({ _recorded: recorded } as Partial<ReviewCalibrateDeps>),
  } as ReviewCalibrateDeps & { _recorded: CalibrationSample[] };
}

function recordedOf(d: ReviewCalibrateDeps): readonly CalibrationSample[] {
  return (d as unknown as { _recorded: CalibrationSample[] })._recorded;
}

describe("runReviewCalibrate — recording the owner's call", () => {
  it("records the owner's judgement against the classifier's own stored call", async () => {
    const d = deps({ findings: () => [finding({ id: "f-1", classification: "advisory" })] });
    const result = await runReviewCalibrate(
      { findingId: "f-1", ownerClassification: "blocking" },
      d,
    );

    expect(result.ok).toBe(true);
    expect(recordedOf(d)).toEqual([
      {
        findingId: "f-1",
        owner: "blocking",
        classifier: "advisory",
        rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
      },
    ]);
  });

  /**
   * The property that stops the classifier grading itself: there is no input for
   * its own call, so a caller cannot supply a flattering one.
   */
  it("ignores a classifier call supplied by the caller", async () => {
    const d = deps({ findings: () => [finding({ id: "f-1", classification: "blocking" })] });
    await runReviewCalibrate(
      {
        findingId: "f-1",
        ownerClassification: "blocking",
        // Not part of the input contract; passed here as a caller would if it
        // tried, to assert it changes nothing.
        ...({ classifier: "advisory" } as Record<string, unknown>),
      },
      d,
    );
    expect(recordedOf(d)[0]?.classifier).toBe("blocking");
  });

  it("refuses a finding that is not on record rather than inventing its classification", async () => {
    const d = deps({ findings: () => [finding({ id: "f-1" })] });
    const result = await runReviewCalibrate(
      { findingId: "does-not-exist", ownerClassification: "blocking" },
      d,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("does-not-exist");
    expect(recordedOf(d)).toEqual([]);
  });

  it("refuses a judgement with no finding named", async () => {
    const result = await runReviewCalibrate({ ownerClassification: "blocking" }, deps());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/findingId/);
  });

  it("returns the rescored corpus, so the caller sees what its judgement bought", async () => {
    const d = deps({
      findings: () => [finding({ id: "f-1" })],
      samples: () => [{ findingId: "f-0", owner: "blocking", classifier: "blocking" }],
    });
    const result = await runReviewCalibrate(
      { findingId: "f-1", ownerClassification: "advisory" },
      d,
    );
    // Scored over the corpus INCLUDING the sample just recorded — a status that
    // still said zero would be reporting the state before the call that changed it.
    expect(result.calibration?.sampleSize).toBe(2);
    expect(result.calibration?.calibrated).toBe(false);
    // Both labels came through the targeted path (the default provenance), so
    // neither scores: the gate reports what exists and what it still needs,
    // rather than claiming nobody has labelled anything.
    expect(result.calibration?.randomSampleSize).toBe(0);
    expect(result.calibration?.excludedNonRandom).toBe(2);
    expect(result.calibration?.verdictReason).toMatch(/none were uniformly drawn/);
  });
});

/**
 * WHICH FINDINGS TO ASK ABOUT.
 *
 * Twenty samples is real owner labour, and labelling at random spends it badly:
 * the informative cases are the ones near the decision boundary, which is the
 * standard disagreement/uncertainty-sampling result from the active-learning
 * literature. Here the boundary is visible for free in the dispositions already on
 * record — an `advisory` finding somebody fixed anyway, and a `blocking` finding
 * that got refuted, are the two shapes a misclassification leaves behind.
 *
 * They are SUGGESTIONS, never labels. A disposition is evidence about the
 * classifier, not the owner's verdict on it, and promoting one to a sample would
 * be the classifier grading itself off its own downstream consequences.
 */
describe("runReviewCalibrate — candidates to ask the owner about", () => {
  const fixedAdvisory = finding({
    id: "under",
    classification: "advisory",
    disposition: "fixed",
    dispositionEvidence: "fixed in the same change set",
  });
  const refutedBlocking = finding({
    id: "over",
    classification: "blocking",
    violates: "implement-gates-pass",
    disposition: "refuted",
    dispositionEvidence: "the path is unreachable",
  });
  const ordinary = finding({ id: "plain", classification: "advisory" });

  it("surfaces the two disagreement shapes ahead of ordinary findings", async () => {
    const result = await runReviewCalibrate(
      {},
      deps({ findings: () => [ordinary, fixedAdvisory, refutedBlocking] }),
    );

    expect(result.ok).toBe(true);
    const ids = result.candidates?.map((c) => c.findingId) ?? [];
    expect(ids.slice(0, 2).sort()).toEqual(["over", "under"]);
    expect(ids).toContain("plain");
  });

  it("says WHY each candidate is worth asking about", async () => {
    const result = await runReviewCalibrate({}, deps({ findings: () => [fixedAdvisory] }));
    expect(result.candidates?.[0]?.why).toMatch(/advisory/i);
    expect(result.candidates?.[0]?.classifier).toBe("advisory");
  });

  it("does not re-ask about a finding already judged under the current rubric", async () => {
    const result = await runReviewCalibrate(
      {},
      deps({
        findings: () => [fixedAdvisory, refutedBlocking],
        samples: () => [
          {
            findingId: "under",
            owner: "blocking",
            classifier: "advisory",
            rubricVersion: CLASSIFICATION_RUBRIC_VERSION,
          },
        ],
      }),
    );
    const ids = result.candidates?.map((c) => c.findingId) ?? [];
    expect(ids).not.toContain("under");
    expect(ids).toContain("over");
  });

  /**
   * A rubric rewrite invalidates old judgements, so those findings become worth
   * asking about again — which is the whole reason the samples carry a rubric.
   */
  it("re-asks about a finding whose only judgement was under another rubric", async () => {
    const result = await runReviewCalibrate(
      {},
      deps({
        findings: () => [fixedAdvisory],
        samples: () => [
          {
            findingId: "under",
            owner: "blocking",
            classifier: "advisory",
            rubricVersion: CLASSIFICATION_RUBRIC_VERSION + 1,
          },
        ],
      }),
    );
    expect(result.candidates?.map((c) => c.findingId)).toContain("under");
  });

  /**
   * A capped list must say what it dropped. A truncated suggestion list that reads
   * as complete is how "we asked about everything" gets believed.
   */
  it("caps the list and reports the true total rather than truncating silently", async () => {
    const many = Array.from({ length: 12 }, (_unused, index) =>
      finding({ id: `f-${String(index)}` }),
    );
    const result = await runReviewCalibrate({}, deps({ findings: () => many }));
    expect(result.candidates?.length).toBeLessThan(12);
    expect(result.candidatesTotal).toBe(12);
  });

  it("reports the corpus status even with nothing to suggest", async () => {
    const result = await runReviewCalibrate({}, deps());
    expect(result.candidates).toEqual([]);
    expect(result.candidatesTotal).toBe(0);
    expect(result.calibration?.sampleSize).toBe(0);
    expect(result.calibration?.verdictReason).toMatch(/nobody/i);
  });
});

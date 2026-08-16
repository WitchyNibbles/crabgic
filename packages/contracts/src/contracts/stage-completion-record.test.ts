import { describe, expect, it } from "vitest";
import { PIPELINE_STAGE_IDS } from "./pipeline-stages.js";
import {
  StageCompletionRecordSchema,
  stageCompleted,
  completedStageIds,
  type StageCompletionRecord,
} from "./stage-completion-record.js";

/**
 * `StageCompletionRecord` — owner ruling R8 (2026-08-16), and ledger Gap 23's
 * disclosed residual 2.
 *
 * The residual: `pipeline.plan` takes `completedStages` from its CALLER, so it
 * can refuse a completion set with a HOLE in it but cannot refuse a caller
 * claiming a stage it never ran. R8 makes dispatch depend on the `design-gate`
 * stage having closed, which turns that residual from a disclosure into a
 * load-bearing hole: a caller who can claim a stage closed could claim the one
 * the run now hangs on.
 *
 * These tests are written against the property that closes it — a record the
 * SERVER writes from its own closure computation, never from a caller's claim.
 */

const VALID: StageCompletionRecord = {
  schemaVersion: 1,
  changeSetId: "5a1e0c30-7b21-4a44-9c10-2f7d4e9b8c01",
  stage: "research",
  round: 3,
  artifactRef: "research-record:5f3a1b2c-8e4d-4a9f-9c21-6b7d0a3e5f18",
  closedAt: "2026-08-16T14:00:00.000Z",
};

describe("StageCompletionRecordSchema", () => {
  it("accepts a well-formed record", () => {
    expect(StageCompletionRecordSchema.parse(VALID)).toEqual(VALID);
  });

  /**
   * The positive control above is what makes every refusal below mean
   * something. Without it they would all pass for a schema that accepts
   * nothing at all.
   */
  it("refuses a stage id that is not in the roster", () => {
    // A record naming a stage the pipeline does not have is a completion of
    // nothing, and it would satisfy an ordering check by occupying a slot no
    // stage can ever fill.
    expect(() => StageCompletionRecordSchema.parse({ ...VALID, stage: "not-a-stage" })).toThrow();
  });

  it("accepts every stage in the roster, so no stage is unrecordable", () => {
    // The inverse of the test above, and the one that would catch a roster
    // grown past what this schema knows about — a stage that can close but
    // cannot be RECORDED as closed is a permanent hole in the ordering check.
    for (const stage of PIPELINE_STAGE_IDS) {
      expect(() => StageCompletionRecordSchema.parse({ ...VALID, stage }), stage).not.toThrow();
    }
  });

  it("requires the round it closed on", () => {
    // Which round a stage closed on is the only durable evidence of whether it
    // converged or was pushed through, and it is unrecoverable afterwards.
    const { round: _round, ...withoutRound } = VALID;
    expect(() => StageCompletionRecordSchema.parse(withoutRound)).toThrow();
  });

  it("refuses round zero — a stage cannot close on a round that never ran", () => {
    expect(() => StageCompletionRecordSchema.parse({ ...VALID, round: 0 })).toThrow();
  });

  it("requires the artifact the stage closed over", () => {
    // A completion that does not say WHAT closed carries forward across an
    // edit, which is the same failure OwnerDesignVerdict binds its revision to
    // prevent, one stage more general.
    const { artifactRef: _ref, ...withoutRef } = VALID;
    expect(() => StageCompletionRecordSchema.parse(withoutRef)).toThrow();
  });

  it("is strict — an unknown field is refused rather than ignored", () => {
    // Notably `closable: true`. A caller that could smuggle its own verdict
    // into this record would be re-opening the exact hole R8 exists to close.
    expect(() => StageCompletionRecordSchema.parse({ ...VALID, closable: true })).toThrow();
  });

  it("has no field by which a caller could assert closure", () => {
    // The record says a stage DID close; it carries no input to the question.
    // Asserted structurally rather than by review, since a later field named
    // `verdict` or `closable` would be the whole defect.
    const keys = Object.keys(VALID).sort();
    expect(keys).toEqual(
      ["artifactRef", "changeSetId", "closedAt", "round", "schemaVersion", "stage"].sort(),
    );
  });
});

describe("completedStageIds", () => {
  it("returns the stages recorded for this change set and no others", () => {
    const records: StageCompletionRecord[] = [
      { ...VALID, stage: "research" },
      { ...VALID, stage: "clarify" },
      { ...VALID, changeSetId: "11111111-1111-4111-8111-111111111111", stage: "design" },
    ];
    expect(completedStageIds(records, VALID.changeSetId)).toEqual(["research", "clarify"]);
  });

  it("returns an empty list for a change set with no records", () => {
    // Empty must mean "nothing has closed", never "everything has". This is the
    // fail-safe direction, and it is the one that keeps dispatch refused.
    expect(completedStageIds([], VALID.changeSetId)).toEqual([]);
  });

  it("deduplicates a stage recorded more than once", () => {
    // Records append — a stage re-opened by an edit and re-closed writes twice,
    // and the ordering check must see one closed stage, not two.
    const records: StageCompletionRecord[] = [
      { ...VALID, stage: "research", round: 2 },
      { ...VALID, stage: "research", round: 5 },
    ];
    expect(completedStageIds(records, VALID.changeSetId)).toEqual(["research"]);
  });
});

describe("stageCompleted", () => {
  it("is true only for a stage recorded against this change set", () => {
    const records: StageCompletionRecord[] = [{ ...VALID, stage: "design-gate" }];
    expect(stageCompleted(records, VALID.changeSetId, "design-gate")).toBe(true);
    expect(stageCompleted(records, VALID.changeSetId, "plan")).toBe(false);
  });

  /**
   * The R8 arm. Dispatch will hang on exactly this call, so a record belonging
   * to a DIFFERENT change set must not open the gate — otherwise one approved
   * design would authorize every subsequent run.
   */
  it("is false for a record belonging to another change set", () => {
    const records: StageCompletionRecord[] = [
      { ...VALID, changeSetId: "11111111-1111-4111-8111-111111111111", stage: "design-gate" },
    ];
    expect(stageCompleted(records, VALID.changeSetId, "design-gate")).toBe(false);
  });

  it("is false on an empty store", () => {
    expect(stageCompleted([], VALID.changeSetId, "design-gate")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { CONTRACT_SECTIONS } from "./intent-contract.js";
import {
  PIPELINE_STAGES,
  exitCriteriaFor,
  stageById,
  type PipelineStageId,
} from "./pipeline-stages.js";

/**
 * The stage list and its exit criteria — `docs/staged-review-pipeline.md` §4.4,
 * promoted from an illustrative table to the checkable list the design says it
 * has to be.
 *
 * §4.1's termination rule is "every one of its written exit criteria is met".
 * Written is the operative word: a stage whose criteria live only in prose has
 * the same termination problem the superseded loop had, one level up.
 */

describe("PIPELINE_STAGES", () => {
  it("covers the pipeline end to end, in order", () => {
    expect(PIPELINE_STAGES.map((stage) => stage.id)).toEqual([
      "research",
      "clarify",
      "design",
      "plan",
      "implement",
      "integrate",
    ]);
  });

  it("gives every stage at least one exit criterion", () => {
    // A stage with no criteria can never close on §4.1's rule -- or closes
    // vacuously, which is worse.
    for (const stage of PIPELINE_STAGES) {
      expect(stage.exitCriteria.length).toBeGreaterThan(0);
    }
  });

  it("gives every criterion a stable id and a checkable statement", () => {
    for (const stage of PIPELINE_STAGES) {
      for (const criterion of stage.exitCriteria) {
        expect(criterion.id).toMatch(/^[a-z0-9-]+$/);
        expect(criterion.statement.length).toBeGreaterThan(20);
      }
    }
  });

  it("keeps every criterion id unique across the whole pipeline", () => {
    // A blocking finding names the criterion it violates. If two stages shared
    // an id, that name would not identify which criterion, and the rule that
    // makes termination possible would be ambiguous.
    const ids = PIPELINE_STAGES.flatMap((stage) =>
      stage.exitCriteria.map((c: { id: string }) => c.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every stage that has a reviewer at least two lenses", () => {
    // Diversity by lens is what replaced repetition of one hostile pass. A
    // single-lens stage is a repeated pass wearing a different name.
    for (const stage of PIPELINE_STAGES) {
      if (stage.lenses.length === 0) continue;
      expect(stage.lenses.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives the research stage the three lenses the owner ruled for", () => {
    // Owner ruling 2026-07-29 §7.4: research runs first and everything
    // downstream commits to it, so a stale-but-well-cited source costs more
    // there than anywhere else.
    expect(stageById("research").lenses).toEqual([
      "completeness",
      "source-quality",
      "assumption-audit",
    ]);
  });
});

describe("the clarify stage reuses the contract sections", () => {
  it("derives its criteria from CONTRACT_SECTIONS rather than restating them", () => {
    // This stage already terminates correctly in the shipped product, and its
    // exit condition is the model the rest of the pipeline copies. Restating
    // the nine sections here would be a second copy to drift -- the same
    // mistake this repository has paid for repeatedly.
    const ids = stageById("clarify").exitCriteria.map((criterion: { id: string }) => criterion.id);
    for (const section of CONTRACT_SECTIONS) {
      expect(ids.some((id: string) => id.includes(section))).toBe(true);
    }
  });
});

describe("stages that produce no reviewable artifact have no lenses", () => {
  it("clarify and integrate are gated by a human or by tools, not by a reviewer", () => {
    // Clarify closes on the owner's answers; integrate closes on the
    // final-candidate gate. Neither is a judged artifact, and giving them a
    // reviewer would invent review work with nothing to review.
    expect(stageById("clarify").lenses).toEqual([]);
    expect(stageById("integrate").lenses).toEqual([]);
  });
});

describe("exitCriteriaFor", () => {
  it("returns the ids a stage must satisfy to close", () => {
    expect(exitCriteriaFor("plan").length).toBeGreaterThan(0);
    expect(exitCriteriaFor("plan").every((id: string) => typeof id === "string")).toBe(true);
  });

  it("throws for a stage that does not exist, rather than returning nothing to satisfy", () => {
    // Returning `[]` would make an unknown stage close immediately, which is
    // the vacuous-pass failure mode in its purest form.
    expect(() => exitCriteriaFor("nonsense" as PipelineStageId)).toThrow(/unknown stage/i);
  });
});

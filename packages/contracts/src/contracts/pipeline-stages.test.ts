import { describe, expect, it } from "vitest";
import { CONTRACT_SECTIONS } from "./intent-contract.js";
import { DOMAIN_LENS_IDS } from "./domain-lenses.js";
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
    // Nine stages as of the owner's rulings of 2026-08-15
    // (`docs/design/owner-pipeline-conformance.md` §5.1). Three are new:
    // `design-gate` (R2 -- the owner confirms the design before anything is
    // dispatched), `audit` (the per-domain pass over the finished product), and
    // `document` (the user and maintenance guides, which had no stage at all).
    expect(PIPELINE_STAGES.map((stage) => stage.id)).toEqual([
      "research",
      "clarify",
      "design",
      "design-gate",
      "plan",
      "implement",
      "integrate",
      "audit",
      "document",
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
  it("clarify, design-gate and integrate are gated by a human or by tools, not by a reviewer", () => {
    // Clarify closes on the owner's answers; `design-gate` closes on the
    // owner's verdict and on nothing else; integrate closes on the
    // final-candidate gate. None is a judged artifact, and giving them a
    // reviewer would invent review work with nothing to review -- worse, at
    // `design-gate` it would create a route to closure that is not the owner,
    // which is exactly what makes it a gate rather than a checkpoint.
    expect(stageById("clarify").lenses).toEqual([]);
    expect(stageById("design-gate").lenses).toEqual([]);
    expect(stageById("integrate").lenses).toEqual([]);
  });
});

describe("the stages added by the 2026-08-15 rulings", () => {
  it("gives design-gate exactly one criterion, and it names the owner", () => {
    // R2. The stage exists so the owner can say "this is not what I meant"
    // before a single worker is dispatched -- steps 6 and 7 of the owner's
    // pipeline. A criterion that could be met by anyone else would defeat it.
    const criteria = stageById("design-gate").exitCriteria;
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.statement.toLowerCase()).toContain("owner");
  });

  it("audits the end product through the domain lenses, not through a fresh vocabulary", () => {
    // The owner asked for the audit to use the same per-domain specialists the
    // design stage uses. Inventing a second roster for the audit would make
    // "backend" mean two things, and a blocking finding names its lens.
    const lenses = stageById("audit").lenses;
    expect(lenses.length).toBeGreaterThanOrEqual(2);
    for (const lens of lenses) {
      expect(DOMAIN_LENS_IDS as readonly string[]).toContain(lens);
    }
  });

  it("gives the document stage criteria about coverage, not about prose quality", () => {
    // "Easy to read and detailed" is what the owner asked for, and readability
    // is a lens. The CRITERIA are coverage claims, because those are the half a
    // record can decide -- every command documented, every failure mode named,
    // and no guide claiming a command that does not exist.
    const ids = stageById("document").exitCriteria.map((criterion) => criterion.id);
    expect(ids).toContain("document-user-guide-covers-every-command");
    expect(ids).toContain("document-maintenance-guide-covers-every-failure-mode");
    expect(ids).toContain("document-claims-resolve");
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

describe("the implement stage's evaluator panel", () => {
  it("runs FOUR evaluators, which is what the owner asked for", () => {
    // "4 specialized skill charged agents evaluate the work (security, code
    // reviewer, compliance)" plus best practice for the stack.
    //
    // This test exists twice over: the change it guards was made once, lost to
    // a wholesale `git checkout` during an unrelated cleanup, and reported in a
    // commit message as delivered while the source said otherwise. A claim in
    // prose is not a claim anything checks.
    expect(stageById("implement").lenses).toHaveLength(4);
  });

  it("takes compliance and clean-code from the DOMAIN roster, not a local list", () => {
    // A second vocabulary would make `compliance` mean one thing at implement
    // and another at audit, while a blocking finding identifies itself by lens.
    for (const lens of ["compliance", "clean-code"]) {
      expect(stageById("implement").lenses).toContain(lens);
      expect(DOMAIN_LENS_IDS as readonly string[]).toContain(lens);
    }
  });
});

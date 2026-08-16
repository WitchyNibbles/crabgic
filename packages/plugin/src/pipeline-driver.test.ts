import { describe, expect, it } from "vitest";
import { DOMAIN_LENS_IDS, PIPELINE_STAGE_IDS, type StackEvidence } from "@crabgic/contracts";
import {
  STAGE_ORDER,
  isOwnerGated,
  nextStage,
  planStageRound,
  roundBudgetFor,
} from "./pipeline-driver.js";

/**
 * The driver's decisions — roadmap/25 work item 7, closing
 * `docs/staged-review-pipeline.md` §8.4 in favour of a `Workflow` script.
 *
 * WHY THE DECISIONS LIVE HERE AND NOT IN THE `.mjs` SCRIPT. A workflow script
 * runs inside the harness, so anything decided there is decided somewhere no
 * test can reach. The audit that produced this phase found the whole pipeline in
 * exactly that state — stage order, lens coverage and the round ceiling existed
 * only as prose in an always-loaded `CLAUDE.md` block, which a model may skip.
 * Moving the prose into an untestable script would have relocated the problem
 * rather than fixed it.
 *
 * So the script is glue: it calls these functions and spawns what they return.
 */

const stack = (findings: readonly { category: string; ecosystem: string }[]): StackEvidence =>
  ({
    schemaVersion: 1,
    id: "11111111-2222-4333-8444-555555555555",
    createdAt: "2026-08-15T00:00:00.000Z",
    findings: findings.map((f) => ({ ...f, detail: "fixture", path: "fixture", confidence: 1 })),
    contradictions: [],
    unresolvedAmbiguity: [],
  }) as StackEvidence;

const EMPTY_STACK = stack([]);

describe("STAGE_ORDER", () => {
  it("is the contract's stage list, not a second copy of it", () => {
    // Two lists that must agree diverge. This repository has paid for that at
    // the contract sections and at the path normalizer; the driver does not
    // make it a third time.
    expect(STAGE_ORDER).toEqual(PIPELINE_STAGE_IDS);
  });
});

describe("nextStage — stage order as program state", () => {
  it("starts at research when nothing is complete", () => {
    expect(nextStage([])).toBe("research");
  });

  it("advances one stage at a time", () => {
    expect(nextStage(["research"])).toBe("clarify");
    expect(nextStage(["research", "clarify"])).toBe("design");
  });

  it("returns undefined once every stage is complete", () => {
    expect(nextStage([...PIPELINE_STAGE_IDS])).toBeUndefined();
  });

  it("REFUSES a completion set that skipped a stage", () => {
    // The audit's finding, made mechanical: "a manager that goes design ->
    // implement, skipping plan, violates nothing". It violates this.
    expect(() => nextStage(["research", "clarify", "design", "plan"])).toThrow(/design-gate/);
  });

  it("names the stage that was skipped, not merely that one was", () => {
    // A refusal an operator cannot act on sends them reading the whole roster.
    expect(() => nextStage(["research", "design"])).toThrow(/clarify/);
  });

  it("accepts the stages in canonical order regardless of the order given", () => {
    // Completion is a SET. A caller recording completions out of order has not
    // skipped anything, and refusing that would be an accident of bookkeeping.
    expect(nextStage(["clarify", "research"])).toBe("design");
  });
});

describe("planStageRound — lens coverage as program state", () => {
  it("issues every lens the stage declares", () => {
    const plan = planStageRound("design", EMPTY_STACK);
    expect(plan.lenses.map((l) => l.lens)).toEqual(["contract-fit", "security", "operability"]);
  });

  it("issues each lens the stage's exit criteria as its obligations", () => {
    // BOUND 2 in `admissibility.ts` treats an empty obligation list as UNMET.
    // A driver that dispatched a lens with no checklist would therefore stall
    // the stage forever, so this is the seam where that bound gets its input.
    const plan = planStageRound("design", EMPTY_STACK);
    for (const lens of plan.lenses) {
      expect(lens.obligations.length).toBeGreaterThan(0);
      expect(lens.obligations).toContain("design-risks-have-mitigations");
    }
  });

  it("runs the audit stage through the applicable DOMAIN lenses", () => {
    // The owner asked for the end-product audit to use the same per-domain
    // specialists the design stage uses.
    const plan = planStageRound("audit", stack([{ category: "container", ecosystem: "docker" }]));
    const ids = plan.lenses.map((l) => l.lens);
    expect(ids).toContain("infrastructure");
    for (const id of ids) expect(DOMAIN_LENS_IDS as readonly string[]).toContain(id);
  });

  it("records the domain lenses it skipped, with reasons", () => {
    // The partition property, carried through to the driver: a lens that did
    // not run is visible. "We audited it" must not be able to mean five of six.
    const plan = planStageRound("audit", EMPTY_STACK);
    expect(plan.skipped.length).toBeGreaterThan(0);
    for (const skipped of plan.skipped) expect(skipped.reason.length).toBeGreaterThan(10);
  });

  it("puts every domain lens in exactly one side at the audit stage", () => {
    const plan = planStageRound("audit", stack([{ category: "ci", ecosystem: "react" }]));
    const seen = [...plan.lenses.map((l) => l.lens), ...plan.skipped.map((s) => s.lens)];
    expect(new Set(seen).size).toBe(DOMAIN_LENS_IDS.length);
  });

  it("plans no lenses for an owner-gated stage", () => {
    // `clarify` and `design-gate` close on the owner; `integrate` on a gate.
    // Dispatching a reviewer at any of them would invent review work with
    // nothing to review -- and at `design-gate` it would manufacture a route to
    // closure that is not the owner, which is what makes it a gate at all.
    for (const stage of ["clarify", "design-gate", "integrate"] as const) {
      expect(planStageRound(stage, EMPTY_STACK).lenses).toEqual([]);
    }
  });

  it("still issues obligations for a stage with no lenses", () => {
    // The stage's criteria must be answered by somebody -- the owner, or a
    // gate. Returning nothing here would let the caller treat an owner-gated
    // stage as having no requirements at all.
    expect(planStageRound("design-gate", EMPTY_STACK).obligations.length).toBeGreaterThan(0);
  });

  it("throws for a stage that does not exist", () => {
    // Same reason `exitCriteriaFor` throws: a typo that returned an empty plan
    // would dispatch no reviewers and read as a stage with nothing to check.
    // @ts-expect-error -- deliberately outside the union
    expect(() => planStageRound("nonsense", EMPTY_STACK)).toThrow(/unknown stage/i);
  });
});

describe("isOwnerGated", () => {
  it("names design-gate and clarify, and nothing else", () => {
    const gated = PIPELINE_STAGE_IDS.filter(isOwnerGated);
    expect(gated).toEqual(["clarify", "design-gate"]);
  });

  it("does not treat integrate as owner-gated", () => {
    // Integrate has no lenses either, but it closes on the final-candidate
    // GATE. Conflating "no reviewer" with "needs a human" would make the
    // pipeline stop for the owner at a place a tool decides.
    expect(isOwnerGated("integrate")).toBe(false);
  });
});

describe("roundBudgetFor", () => {
  it("is the runaway guard, not the superseded ceiling", () => {
    // Ruling R4: rounds are bounded by the guard, and a healthy stage closes on
    // the first quiet round long before it.
    expect(roundBudgetFor("implement")).toBe(20);
  });

  it("gives an owner-gated stage a budget of one", () => {
    // There is no loop to run: the owner answers, or they do not. Looping on a
    // human is the check-in behaviour the protocol forbids.
    expect(roundBudgetFor("design-gate")).toBe(1);
    expect(roundBudgetFor("clarify")).toBe(1);
  });
});

describe("planStageRound — which reviewer each lens is dispatched to", () => {
  // WHY THIS EXISTS. `workflows/stage-round.mjs` hardcoded
  // `agentType: "eo-domain-reviewer"` for EVERY lens it dispatched. Only the
  // audit stage plans domain lenses; every other stage plans PIPELINE lenses,
  // which are `eo-reviewer`'s charter. The shipped workflow therefore sent
  // `completeness`, `source-quality`, `assumption-audit`, `contract-fit`,
  // `operability`, `coverage-of-design`, `sequencing`, `correctness` and
  // `readability` to a reviewer whose own definition lists eight lens names,
  // none of which are those — and never dispatched `eo-reviewer` at all.
  //
  // The script cannot fix this itself: a workflow script has no imports, so it
  // cannot read `DOMAIN_LENS_IDS` to tell the two families apart. So the plan
  // carries the answer, for the same reason it already carries the lens list.

  it("routes a domain lens to eo-domain-reviewer", () => {
    const plan = planStageRound("audit", EMPTY_STACK);
    for (const lens of plan.lenses) {
      expect(DOMAIN_LENS_IDS).toContain(lens.lens);
      expect(lens.reviewer).toBe("eo-domain-reviewer");
    }
  });

  it("routes a pipeline lens to eo-reviewer", () => {
    const plan = planStageRound("research", EMPTY_STACK);
    expect(plan.lenses.map((l) => l.lens)).toEqual([
      "completeness",
      "source-quality",
      "assumption-audit",
    ]);
    for (const lens of plan.lenses) expect(lens.reviewer).toBe("eo-reviewer");
  });

  it("splits a stage whose lens list mixes both families", () => {
    // `implement` plans `correctness` and `security` (pipeline) alongside
    // `compliance` and `clean-code` (domain). A single hardcoded agent type is
    // wrong for half of them whichever one it picks — which is the argument for
    // deriving it per lens rather than per stage.
    const byLens = new Map(
      planStageRound("implement", EMPTY_STACK).lenses.map((l) => [l.lens, l.reviewer]),
    );
    expect(byLens.get("correctness")).toBe("eo-reviewer");
    expect(byLens.get("security")).toBe("eo-reviewer");
    expect(byLens.get("compliance")).toBe("eo-domain-reviewer");
    expect(byLens.get("clean-code")).toBe("eo-domain-reviewer");
  });

  it("names a reviewer for every lens of every stage", () => {
    // No stage may plan a lens with no reviewer: an undispatchable lens is an
    // unanswered obligation, and `admissibility.ts` bound 2 holds the stage open
    // on it forever.
    for (const stage of PIPELINE_STAGE_IDS) {
      for (const lens of planStageRound(stage, EMPTY_STACK).lenses) {
        expect(lens.reviewer, `${stage}/${lens.lens}`).toMatch(/^eo-(domain-)?reviewer$/);
      }
    }
  });
});

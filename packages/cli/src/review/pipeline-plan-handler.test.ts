import { describe, expect, it } from "vitest";
import { DOMAIN_LENS_IDS } from "@crabgic/contracts";
import { runPipelinePlan } from "./pipeline-plan-handler.js";

/**
 * `pipeline.plan` — roadmap/25 work item 7.
 *
 * The audit's fourth finding was that stage order, lens coverage and the round
 * budget lived in prose a model may skip. These tests are the mechanism that
 * replaced the prose, exercised through the surface the manager actually calls.
 */

describe("runPipelinePlan — stage order", () => {
  it("starts at research", () => {
    const result = runPipelinePlan({ completedStages: [] });
    expect(result.stage).toBe("research");
  });

  it("advances one stage at a time", () => {
    expect(runPipelinePlan({ completedStages: ["research", "clarify"] }).stage).toBe("design");
  });

  it("REFUSES a completion set that skipped a stage, naming the stage skipped", () => {
    // The audit's finding, now mechanical: a manager that goes design ->
    // implement, skipping plan, used to violate nothing.
    const result = runPipelinePlan({
      completedStages: ["research", "clarify", "design", "plan"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/design-gate/);
  });

  it("refuses an unrecognized stage rather than ignoring it", () => {
    // Dropping it silently would shift the sequence by one and hand back the
    // wrong next stage, which is worse than refusing.
    const result = runPipelinePlan({ completedStages: ["reserch"] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown stage/i);
  });

  it("reports finished when every stage is complete", () => {
    const all = [
      "research",
      "clarify",
      "design",
      "design-gate",
      "plan",
      "implement",
      "integrate",
      "audit",
      "document",
    ];
    expect(runPipelinePlan({ completedStages: all }).finished).toBe(true);
  });
});

describe("runPipelinePlan — what to dispatch", () => {
  it("issues every lens an obligation checklist", () => {
    // `admissibility.ts` bound 2 treats an empty checklist as UNMET, so a lens
    // dispatched without one would stall its own stage forever.
    const result = runPipelinePlan({ completedStages: ["research", "clarify"] });
    expect(result.lenses?.length).toBeGreaterThan(0);
    for (const lens of result.lenses ?? []) {
      expect(lens.obligations.length).toBeGreaterThan(0);
    }
  });

  it("marks an owner-gated stage and gives it a single round", () => {
    // There is no loop to run on a human. Looping is the "shall I proceed?"
    // check-in the manager protocol forbids.
    const result = runPipelinePlan({
      completedStages: ["research", "clarify", "design"],
    });
    expect(result.stage).toBe("design-gate");
    expect(result.ownerGated).toBe(true);
    expect(result.roundBudget).toBe(1);
    expect(result.lenses).toEqual([]);
  });

  it("gives a reviewed stage the runaway guard as its budget", () => {
    const result = runPipelinePlan({ completedStages: ["research", "clarify"] });
    expect(result.roundBudget).toBe(20);
    expect(result.ownerGated).toBe(false);
  });

  it("plans the audit stage through the domain lenses and reports the skipped ones", () => {
    const done = ["research", "clarify", "design", "design-gate", "plan", "implement", "integrate"];
    const result = runPipelinePlan({
      completedStages: done,
      stackEvidence: {
        schemaVersion: 1,
        id: "11111111-2222-4333-8444-555555555555",
        createdAt: "2026-08-15T00:00:00.000Z",
        findings: [
          {
            category: "container",
            ecosystem: "docker",
            detail: "Dockerfile",
            path: "Dockerfile",
            confidence: 1,
          },
        ],
        contradictions: [],
        unresolvedAmbiguity: [],
      },
    });
    expect(result.stage).toBe("audit");
    expect(result.lenses?.map((l) => l.lens)).toContain("infrastructure");
    const seen = [
      ...(result.lenses ?? []).map((l) => l.lens),
      ...(result.skippedLenses ?? []).map((s) => s.lens),
    ];
    expect(new Set(seen).size).toBe(DOMAIN_LENS_IDS.length);
  });
});

describe("runPipelinePlan — absent stack evidence", () => {
  const auditDone = [
    "research",
    "clarify",
    "design",
    "design-gate",
    "plan",
    "implement",
    "integrate",
  ];

  it("degrades to EMPTY evidence, never to 'everything applies'", () => {
    // Running every lens when detection has not run would report a frontend
    // audit on a project with no frontend -- a false coverage claim, and worse
    // than a stated skip.
    const result = runPipelinePlan({ completedStages: auditDone });
    expect(result.lenses?.map((l) => l.lens)).not.toContain("frontend");
    expect(result.skippedLenses?.map((s) => s.lens)).toContain("frontend");
  });

  it("still runs the unconditional lenses on empty evidence", () => {
    // A greenfield repository must not get zero audit coverage.
    const ids = runPipelinePlan({ completedStages: auditDone }).lenses?.map((l) => l.lens) ?? [];
    for (const unconditional of ["testing", "compliance", "clean-code", "target-domain"]) {
      expect(ids).toContain(unconditional);
    }
  });

  it("treats malformed evidence the same as absent, rather than throwing", () => {
    // A caller sending junk should get a conservative plan and a stated skip
    // list, not a crashed pipeline.
    const result = runPipelinePlan({ completedStages: auditDone, stackEvidence: { nope: true } });
    expect(result.ok).toBe(true);
    expect(result.lenses?.map((l) => l.lens)).not.toContain("frontend");
  });
});

/**
 * Owner ruling R8 (2026-08-16), work item 3 — the claim becomes a record.
 *
 * The bound this tool shipped with was that `completedStages` comes from the
 * caller, so a hole could be refused and a lie could not. R8 makes dispatch
 * depend on a stage having closed, which turns that from a disclosed residual
 * into the thing an attacker or a confused caller would aim at.
 *
 * These tests are written so that deleting the derivation reddens them: each one
 * has the caller claiming something the record does not support.
 */
describe("completedStages is derived, not believed — R8", () => {
  it("uses the recorded completions and ignores a caller that claims more", () => {
    // The load-bearing arm. A caller claiming `research` and `clarify` when only
    // `research` is recorded must be planned as if only `research` closed.
    const result = runPipelinePlan({
      completedStages: ["research", "clarify"],
      recordedStages: ["research"],
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("clarify");
  });

  it("reports the stages the caller claimed but nothing recorded", () => {
    // Told, not silently corrected. A caller working from a stale local view
    // needs to know its picture disagrees with the server's, or it will keep
    // submitting against the wrong stage and read the result as a bug.
    const result = runPipelinePlan({
      completedStages: ["research", "clarify"],
      recordedStages: ["research"],
    });
    expect(result.unrecordedClaims).toEqual(["clarify"]);
  });

  it("plans the first stage when the caller claims progress and nothing is recorded", () => {
    // The empty-record case must mean NOTHING closed, never everything. This is
    // the same fail-safe direction the store reads in.
    const result = runPipelinePlan({
      completedStages: ["research", "clarify", "design"],
      recordedStages: [],
    });
    expect(result.stage).toBe("research");
  });

  it("still refuses a recorded set with a hole in it, naming the stage jumped", () => {
    // The property the tool already had must survive the derivation — a record
    // can have a hole too, if a stage was closed out of order.
    const result = runPipelinePlan({ recordedStages: ["research", "design"] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/clarify/);
  });

  it("falls back to the caller's claim when no recorded set is supplied at all", () => {
    // Absent is not the same as empty. An embedder that has not wired the store
    // keeps the pre-R8 behaviour rather than being told nothing has ever closed,
    // and `unrecordedClaims` stays absent so nobody reads a fallback as a
    // disagreement.
    const result = runPipelinePlan({ completedStages: ["research"] });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("clarify");
    expect(result.unrecordedClaims).toBeUndefined();
  });

  it("reports no disagreement when the claim matches the record", () => {
    const result = runPipelinePlan({
      completedStages: ["research"],
      recordedStages: ["research"],
    });
    expect(result.unrecordedClaims).toBeUndefined();
  });
});

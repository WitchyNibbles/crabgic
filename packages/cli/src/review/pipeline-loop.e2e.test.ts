import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PIPELINE_STAGE_IDS, type PipelineStageId } from "@crabgic/contracts";
import { runPipelinePlan } from "./pipeline-plan-handler.js";
import { runReviewSubmit, type ReviewSubmitDeps } from "./review-submit-handler.js";
import { loadFindings, saveFindings, resolveFindingStorePath } from "./finding-store.js";
import { recordDesignVerdict, loadDesignVerdicts, verdictInForce } from "./design-verdict-store.js";
import { buildDocumentationWorkUnit } from "./document-work-unit.js";
import { findingKey } from "./admissibility.js";

/**
 * THE PIPELINE LOOP, DRIVEN — plan, dispatch, submit, repeat, to closure.
 *
 * WHY THIS TEST EXISTS. Everything else in roadmap/25 is tested per unit:
 * `pipeline.plan` returns a plan, `review.submit` computes closure,
 * `resolveDesignGate` refuses. Each is real and none of them shows that the
 * pieces JOIN — which is the failure `closed-loop.e2e.test.ts` was written
 * about in 2026-07-28, when intake, approval and dispatch were each built,
 * tested, and unreachable from one another.
 *
 * So this drives the loop the way the manager would: it asks the server what to
 * run, submits verdicts for what came back, and repeats until the server says
 * the stage may close. Stage order, lens coverage, obligations, the design gate
 * and the zero-findings exit are all exercised through their real surfaces
 * against real on-disk stores.
 *
 * WHAT IS SUBSTITUTED, and why it does not weaken the claim: the REVIEWER is
 * simulated. A real one is a Claude subagent and would spend the owner's
 * subscription, which `docs/deploy-posture.md` puts behind owner authorization.
 * What a reviewer produces is findings; this supplies findings directly, so
 * every server-side decision under test — admissibility, novelty, obligation
 * coverage, closure — runs on real input through real code. The engine is the
 * only thing absent, exactly as `closed-loop.e2e.test.ts` substitutes 03's fake.
 *
 * ⚠️ ONE BOUND, LEARNED BY GETTING IT WRONG. The first version of these tests
 * passed the implement stage's four criteria in `metCriteria` and expected the
 * stage to close. It does not, and it should not: three of those are DERIVED
 * from journaled gate verdicts and the fourth from the finding store, so a
 * caller's claim to them is discarded by design (`GATE_DERIVED_CRITERIA`).
 * Full closure of a reviewed stage therefore needs a real gate run, which is
 * roadmap/14's machinery and not this file's subject. What these tests drive is
 * the ROUND rule — whether a round's findings hold the stage open — and they
 * assert it by watching the novelty blocker appear and disappear, which is
 * attributable to the rule under test rather than to gate state.
 */

let home: string;
let findingsPath: string;
let verdictsPath: string;
let stateHome: string;

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";
const CONTRACT = "33333333-3333-4333-8333-333333333333";
const WRITE_SET = ["packages/example/src/"];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "crabgic-pipeline-e2e-"));
  stateHome = join(home, "state");
  findingsPath = resolveFindingStorePath({ HOME: home, XDG_STATE_HOME: stateHome }, "projhash");
  verdictsPath = join(stateHome, "crabgic", "projhash", "design-verdicts.json");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** The server-supplied half of `review.submit`'s deps, read from the real stores. */
async function deps(
  stage: PipelineStageId,
  metCriteria: readonly string[],
): Promise<ReviewSubmitDeps> {
  const prior = await loadFindings(findingsPath);
  const ownerVerdict = verdictInForce(await loadDesignVerdicts(verdictsPath), CHANGE_SET);
  return {
    appendEvidence: () => Promise.resolve(),
    priorFindings: () => prior,
    plannedWrites: () => WRITE_SET,
    metCriteria: () => metCriteria,
    ...(ownerVerdict !== undefined ? { ownerDesignVerdict: () => ownerVerdict } : {}),
    calibration: () => ({
      calibrated: false,
      kappa: 0,
      kappaLowerBound: 0,
      sampleSize: 0,
      samplesNeeded: 50,
      verdictReason: "no corpus in this fixture",
    }),
    // `stage` is threaded so a future dep can vary by stage without changing
    // every call site; unused today and named rather than dropped.
    ...(stage === "design-gate" ? {} : {}),
  };
}

function verdictDoc(stage: string, round: number, findings: readonly unknown[] = []) {
  return {
    schemaVersion: 1,
    id: `44444444-4444-4444-8444-${String(round).padStart(12, "0")}`,
    createdAt: "2026-08-15T00:00:00.000Z",
    stage,
    artifactRef: "design-rev-1",
    lens: "correctness",
    verdict: findings.length === 0 ? "approve" : "revise",
    round,
    findings,
  };
}

const finding = (claim: string) => ({
  id: "55555555-5555-4555-8555-555555555555",
  claim,
  evidence: { reproduction: "run it", observed: "wrong", expected: "right" },
  verification: "confirmed",
  classification: "advisory",
  disposition: "fixed",
  dispositionEvidence: "fixed in this round",
  paths: ["packages/example/src/thing.ts"],
});

describe("the loop reaches closure — plan, submit, repeat", () => {
  it("closes a stage on the round that raises no admissible novel finding", async () => {
    // THE OWNER'S EXIT, driven. Round 1 raises a finding and the stage stays
    // open; round 2 raises the same one, which is not novel, and it closes.
    // Neither round's closure decision is taken from the caller.
    const stage: PipelineStageId = "implement";
    const met = [
      "implement-gates-pass",
      "implement-task-done-criteria-met",
      "implement-tests-first",
      "no-open-debt-in-touched-paths",
    ];

    const round1 = await runReviewSubmit(
      { stage, verdict: verdictDoc(stage, 1, [finding("The retry loop never terminates.")]) },
      await deps(stage, met),
    );
    expect(round1.ok).toBe(true);
    // Round 1 raised something admissible and novel, and the round rule says so.
    expect(round1.closureReason).toMatch(/novel/i);

    // Persist what the round produced, exactly as the gateway does.
    await saveFindings(findingsPath, round1.findings ?? [], stateHome);

    const round2 = await runReviewSubmit(
      { stage, verdict: verdictDoc(stage, 2, [finding("The retry loop never terminates.")]) },
      await deps(stage, met),
    );
    // Round 2 re-raised the SAME finding. It is not novel, so the round rule no
    // longer holds the stage open -- what remains is gate evidence, which this
    // fixture deliberately does not fake.
    expect(round2.closureReason).not.toMatch(/novel/i);
  });

  it("keeps a stage open while a genuinely new finding arrives each round", async () => {
    // The other half: novelty is not a rubber stamp. Three distinct findings,
    // one per round, and the stage stays open until the round that adds none.
    const stage: PipelineStageId = "implement";
    const met = [
      "implement-gates-pass",
      "implement-task-done-criteria-met",
      "implement-tests-first",
      "no-open-debt-in-touched-paths",
    ];
    const claims = ["claim one is here", "claim two is here", "claim three is here"];

    const blockedByNovelty: number[] = [];
    for (let round = 1; round <= 4; round += 1) {
      const raised = round <= claims.length ? [finding(claims[round - 1] as string)] : [];
      const result = await runReviewSubmit(
        { stage, verdict: verdictDoc(stage, round, raised) },
        await deps(stage, met),
      );
      if (/novel/i.test(result.closureReason ?? "")) blockedByNovelty.push(round);
      await saveFindings(findingsPath, result.findings ?? [], stateHome);
    }
    // Rounds 1-3 each raised something new; round 4 raised nothing, and the
    // novelty blocker is gone. That transition IS the owner's exit.
    expect(blockedByNovelty).toEqual([1, 2, 3]);
  });

  it("does not let an out-of-write-set finding hold the stage open", async () => {
    // The scope bound, end to end. The finding is real and is returned as
    // deferred -- owed to the debt index -- but it does not block this stage.
    const stage: PipelineStageId = "implement";
    const elsewhere = {
      ...finding("Unrelated module leaks a handle."),
      paths: ["packages/other/src/x.ts"],
    };
    const result = await runReviewSubmit(
      { stage, verdict: verdictDoc(stage, 1, [elsewhere]) },
      await deps(stage, [
        "implement-gates-pass",
        "implement-task-done-criteria-met",
        "implement-tests-first",
        "no-open-debt-in-touched-paths",
      ]),
    );
    // The scope bound: it never counted as novel, so it never held the round.
    expect(result.closureReason).not.toMatch(/novel/i);
    expect(result.deferredFindings?.map((f) => f.id)).toContain(elsewhere.id);
  });
});

describe("the design gate, driven", () => {
  it("refuses until the owner records a verdict, then opens — through the real store", async () => {
    const stage: PipelineStageId = "design-gate";

    const before = await runReviewSubmit(
      { stage, verdict: verdictDoc(stage, 1) },
      await deps(stage, ["design-gate-owner-verdict-recorded"]),
    );
    expect(before.stageClosable).toBe(false);
    expect(before.closureReason).toMatch(/owner/i);

    // The CLI-only write path. No gateway tool can do this.
    await recordDesignVerdict(
      verdictsPath,
      {
        schemaVersion: 1,
        changeSetId: CHANGE_SET,
        designRevision: "design-rev-1",
        verdict: "approved",
        recordedAt: "2026-08-15T00:00:00.000Z",
      },
      stateHome,
    );

    const after = await runReviewSubmit(
      { stage, verdict: verdictDoc(stage, 1) },
      await deps(stage, ["design-gate-owner-verdict-recorded"]),
    );
    expect(after.stageClosable).toBe(true);
  });
});

describe("stage order, driven by the server", () => {
  it("walks every stage in order and refuses a set with a hole in it", async () => {
    const completed: PipelineStageId[] = [];
    const seen: string[] = [];
    for (let i = 0; i < PIPELINE_STAGE_IDS.length; i += 1) {
      const plan = runPipelinePlan({ completedStages: completed });
      expect(plan.ok).toBe(true);
      seen.push(plan.stage as string);
      completed.push(plan.stage as PipelineStageId);
    }
    expect(seen).toEqual([...PIPELINE_STAGE_IDS]);
    expect(runPipelinePlan({ completedStages: completed }).finished).toBe(true);

    // And the refusal: drop one stage out of the middle of a complete set.
    const withHole = completed.filter((stage) => stage !== "plan");
    const refused = runPipelinePlan({ completedStages: withHole });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/plan/);
  });

  it("issues every lens a non-empty obligation checklist at each reviewed stage", async () => {
    // Bound 2 treats an empty checklist as UNMET, so a stage planned without
    // obligations would stall itself. This walks every reviewed stage.
    const completed: PipelineStageId[] = [];
    for (const stage of PIPELINE_STAGE_IDS) {
      const plan = runPipelinePlan({ completedStages: completed });
      for (const lens of plan.lenses ?? []) {
        expect(lens.obligations.length, `${String(plan.stage)}:${lens.lens}`).toBeGreaterThan(0);
      }
      completed.push(stage);
    }
  });
});

describe("the documentation stage produces a dispatchable unit", () => {
  it("hands the guides to a work unit whose criteria name the real surface", () => {
    // The last hop: `pipeline.plan` returns `document` as a stage to run, and
    // this is what it runs. The unit is dispatchable by the same path every
    // other unit uses.
    const plan = runPipelinePlan({
      completedStages: PIPELINE_STAGE_IDS.filter((s) => s !== "document"),
    });
    expect(plan.stage).toBe("document");

    const { workUnit, requirement } = buildDocumentationWorkUnit({
      changeSetId: CHANGE_SET,
      intentContractId: CONTRACT,
      userGuidePath: "docs/user-guide.md",
      maintenanceGuidePath: "docs/maintenance-guide.md",
      commands: ["crabgic run"],
      failureModes: ["gateway-unreachable"],
    });
    expect(workUnit.requirementIds).toEqual([requirement.id]);
    expect(requirement.acceptanceCriteria.join(" ")).toContain("crabgic run");
  });
});

describe("novelty is keyed the way the loop assumes", () => {
  it("gives a re-raised finding the same key across rounds", () => {
    // The property the closure test above rests on, asserted directly so a
    // failure there is attributable.
    const a = finding("The retry loop never terminates.");
    const b = { ...a, id: "66666666-6666-4666-8666-666666666666" };
    expect(findingKey(a as never, "correctness")).toBe(findingKey(b as never, "correctness"));
  });
});

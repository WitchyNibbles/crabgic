import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePluginRoot } from "./plugin-root.js";

/**
 * `workflows/stage-round.mjs` — roadmap/25 work item 7, the piece that actually
 * DISPATCHES.
 *
 * `pipeline.plan` decides what should run; this script runs it. Until it
 * existed, every lens the plan named was a review nobody performed.
 *
 * WHY THIS IS TESTED AS TEXT. A workflow script executes inside the harness,
 * against globals (`agent`, `pipeline`, `phase`, `log`, `args`) that do not
 * exist in this process — it cannot be imported or executed here, and
 * `node --check` rejects it because a top-level `return` is only valid in the
 * async body the harness wraps it in. So the properties asserted below are the
 * ones a reader would otherwise have to take on trust, and each corresponds to
 * a way the script could be silently wrong.
 */

const SOURCE = readFileSync(join(resolvePluginRoot(), "workflows", "stage-round.mjs"), "utf8");

describe("the stage-round workflow's contract with the harness", () => {
  it("declares the meta block the Workflow tool requires", () => {
    // Without `export const meta` the script is rejected before it runs, and
    // the failure surfaces as "workflow would not start" rather than as
    // anything pointing here.
    expect(SOURCE).toMatch(/^export const meta = \{/m);
    expect(SOURCE).toMatch(/name: "crabgic-stage-round"/);
    expect(SOURCE).toMatch(/description:/);
  });

  it("declares a phase entry for every phase() call it makes", () => {
    // A phase() with no meta entry gets its own progress group, which is not an
    // error but does mean the user sees a group nobody named.
    const declared = [...SOURCE.matchAll(/\{ title: "([^"]+)"/g)].map((m) => m[1]);
    const used = [...SOURCE.matchAll(/phase: "([^"]+)"/g)].map((m) => m[1]);
    for (const phase of new Set(used)) {
      expect(declared, `phase ${String(phase)} is used but never declared in meta`).toContain(
        phase,
      );
    }
  });

  it("reads its plan from `args` rather than recomputing it", () => {
    // The load-bearing constraint. A workflow script has no imports, so
    // recomputing the stage roster or the lens table here would mean inlining a
    // second copy of a list that must agree with the first — planted at the
    // point that decides what gets reviewed.
    expect(SOURCE).toMatch(/const plan = args/);
    // The real constraint is that it CANNOT import — asserted against import
    // statements rather than against the names, because the docblock mentions
    // `PIPELINE_STAGES` and `DOMAIN_LENSES` precisely to explain why it does
    // not use them. (The first version of this test matched that comment and
    // failed for the wrong reason.)
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/require\(/);
  });

  it("takes each lens's reviewer from the plan and never hardcodes one", () => {
    // WHAT THIS REPLACED, AND WHY. Until 2026-08-16 this asserted
    // `agentType: "eo-domain-reviewer"` was present in the source — so the test
    // PASSED on the defect it should have caught. Only the `audit` stage plans
    // domain lenses; `research`, `design`, `plan`, `implement` and `document`
    // plan pipeline lenses, which are `eo-reviewer`'s charter. One hardcoded
    // agent type sent nine lens names to a reviewer whose definition does not
    // list them, and `eo-reviewer` was dispatched by nothing in the product.
    //
    // A literal agent type anywhere in the dispatch is the defect itself, so the
    // assertion is the absence of one plus the presence of the plan-derived
    // call. Asserting only `reviewerFor(lens)` would still pass with a
    // hardcoded fallback sitting beside it.
    expect(SOURCE).toMatch(/agentType: reviewerFor\(lens\)/);
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/agentType:\s*"/);
  });

  it("refuses a lens the plan did not label, rather than defaulting one", () => {
    // Defaulting is what produced the original defect: a lens with no reviewer
    // silently became a domain reviewer. An older `pipeline.plan` paired with
    // this workflow must fail loudly instead.
    expect(SOURCE).toMatch(/carries no reviewer/);
    expect(SOURCE).toMatch(/throw new Error/);
  });

  it("issues each lens its obligation checklist", () => {
    // Bound 2 treats an empty checklist as UNMET. A dispatch that dropped the
    // obligations would stall every stage it ran.
    expect(SOURCE).toMatch(/lens\.obligations/);
    expect(SOURCE).toMatch(/answeredObligations/);
  });

  it("verifies each finding adversarially before returning it", () => {
    // A finding that nobody tried to break costs a repair attempt on the
    // strength of one reviewer's word.
    expect(SOURCE).toMatch(/REFUTE/);
    expect(SOURCE).toMatch(/phase: "Verify"/);
  });

  it("refuses to run a review round on an owner-gated stage", () => {
    // Dispatching a reviewer at `design-gate` would manufacture a second route
    // to closure that is not the owner — the difference between a gate and a
    // checkpoint.
    expect(SOURCE).toMatch(/ownerGated === true/);
  });

  it("treats a dead agent as UNRUN rather than as an approval", () => {
    // `agent()` returns null when a subagent dies. Letting that fall through
    // would read as a lens that ran and found nothing.
    expect(SOURCE).toMatch(/unrun/);
  });

  it("NEVER decides whether the stage closes", () => {
    // The one thing the whole review surface exists to prevent: closure is
    // computed server-side by `review.submit` from findings on record. A script
    // returning `stageClosable` would be the caller grading its own work.
    expect(SOURCE).not.toMatch(/stageClosable/);
    expect(SOURCE).not.toMatch(/closed:\s*true/);
  });

  it("reports skipped lenses instead of dropping them", () => {
    // "We audited it" must never be able to mean five of the six domains.
    expect(SOURCE).toMatch(/skippedLenses/);
  });
});

describe("the pipeline skill that drives the loop", () => {
  const SKILL = readFileSync(join(resolvePluginRoot(), "skills", "pipeline", "SKILL.md"), "utf8");

  it("names the three surfaces the loop runs on, in order", () => {
    expect(SKILL).toMatch(/pipeline\.plan/);
    expect(SKILL).toMatch(/crabgic-stage-round/);
    expect(SKILL).toMatch(/review\.submit/);
  });

  it("tells the manager it does not decide closure", () => {
    expect(SKILL).toMatch(/never takes closure from you/i);
  });

  it("tells the manager to pass the plan unedited", () => {
    // Dropping a lens or trimming an obligation list is the one way this loop
    // can be made to lie, and it is the edit a hurried manager would reach for.
    expect(SKILL).toMatch(/as it came back/i);
  });

  it("names the CLI command as the design gate's only key", () => {
    expect(SKILL).toMatch(/crabgic design approve/);
  });

  it("states that expanded_authority always halts", () => {
    expect(SKILL).toMatch(/expanded_authority/);
  });
});

describe("the stage-loop workflow — the multi-round driver", () => {
  const LOOP = readFileSync(join(resolvePluginRoot(), "workflows", "stage-loop.mjs"), "utf8");

  it("declares its meta block", () => {
    expect(LOOP).toMatch(/name: "crabgic-stage-loop"/);
  });

  it("asks the server what to run instead of computing it", () => {
    // Same constraint as the round script: no imports, so any roster it
    // recomputed would be a second copy of a list that must agree with the
    // first.
    expect(LOOP).toMatch(/pipeline\.plan/);
    const code = LOOP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\s/m);
  });

  it("submits verdicts through review.submit and does not decide closure itself", () => {
    // The loop owns how many times to go round. It does not own whether the
    // stage may close -- that is computed server-side from findings on record.
    expect(LOOP).toMatch(/review\.submit/);
    expect(LOOP).toMatch(/dispatched\.stageClosable === true/);
    expect(LOOP).not.toMatch(/closed = true;/);
  });

  it("refuses to run without a changeSetId rather than inventing one", () => {
    // Every server call is scoped to a change set. A default would submit a
    // real review against the wrong work.
    expect(LOOP).toMatch(/changeSetId is required/);
  });

  it("returns immediately for an owner-gated stage", () => {
    // There is no loop to run on a human, and looping on one is the check-in
    // the manager protocol forbids.
    expect(LOOP).toMatch(/ownerGated === true/);
    expect(LOOP).toMatch(/awaitingOwner/);
  });

  it("treats a dead round as a failure, not as a clean round", () => {
    // Continuing past a crashed dispatch would let it look like a round that
    // found nothing -- and a round that found nothing is what CLOSES a stage.
    expect(LOOP).toMatch(/the dispatch failed/);
  });

  it("reports reaching the guard as STALLED, never as closed", () => {
    // The guard is not the closure rule. Calling a stall a close is the
    // syntactic kill-switch wearing a verdict's clothes.
    expect(LOOP).toMatch(/stalled/);
    expect(LOOP).toMatch(/runaway guard stopped this stage/);
  });

  it("tells the dispatcher not to edit the plan", () => {
    // Dropping a lens or trimming an obligation list is the one way the loop
    // can be made to lie about what was reviewed.
    expect(LOOP).toMatch(/verbatim/);
  });
});

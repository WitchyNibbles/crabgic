import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePluginRoot } from "./plugin-root.js";

/**
 * `workflows/stage-loop.mjs` — roadmap/25 work item 7, the multi-round loop.
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL. Until 2026-08-17 there was no test of this
 * script, and the loop shipped in a state where it could not run a single round
 * in ANY environment: it asked a SUBAGENT to run the sibling
 * `crabgic-stage-round` workflow, and a subagent has no workflow runtime. The
 * first real invocation escalated with zero of three lenses submitted. Defect
 * `docs/evidence/criteria-closeout/defects/25-stage-loop-cannot-dispatch-a-round.md`.
 *
 * Its sibling `./stage-round-workflow.test.ts` existed and passed throughout,
 * because it tests the script that WAS reachable. The gap was the composition —
 * the same shape as `14-gate-registry-never-composed.md`.
 *
 * WHY TESTED AS TEXT. Identical to the sibling's reasoning: the script runs
 * against harness globals (`agent`, `workflow`, `phase`, `log`, `args`) that do
 * not exist in this process, and `node --check` rejects it because a top-level
 * `return` is only valid inside the async body the harness wraps it in. So these
 * assert the properties a reader would otherwise take on trust, and each names a
 * way the script could be silently wrong again.
 */

const SOURCE = readFileSync(join(resolvePluginRoot(), "workflows", "stage-loop.mjs"), "utf8");
/** Comments stripped, so a property is asserted against CODE and not against prose describing it. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the stage-loop workflow's contract with the harness", () => {
  it("declares the meta block the Workflow tool requires", () => {
    expect(SOURCE).toMatch(/^export const meta = \{/m);
    expect(SOURCE).toMatch(/name: "crabgic-stage-loop"/);
    expect(SOURCE).toMatch(/description:/);
  });

  it("declares a phase entry for every phase() call it makes", () => {
    const declared = [...SOURCE.matchAll(/\{ title: "([^"]+)"/g)].map((m) => m[1]);
    const used = [...SOURCE.matchAll(/phase\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const phase of new Set(used)) {
      expect(declared, `phase ${String(phase)} is used but never declared in meta`).toContain(
        phase,
      );
    }
  });

  it("cannot import anything — the same constraint its sibling has", () => {
    expect(CODE).not.toMatch(/^\s*import\s/m);
    expect(CODE).not.toMatch(/require\(/);
  });
});

describe("the round dispatch (defect 25-stage-loop-cannot-dispatch-a-round)", () => {
  /**
   * ⚠️ THE REGRESSION TEST. Scripts compose workflows; agents make tool calls.
   * The shipped bug was those two responsibilities the wrong way round.
   */
  it("dispatches the round from the SCRIPT via workflow({ scriptPath }), not from an agent", () => {
    expect(CODE).toMatch(/await workflow\(\{\s*scriptPath/);
  });

  /**
   * ⚠️ The exact shape of the defect, asserted directly: no agent prompt may
   * instruct a subagent to RUN the sibling workflow. An agent cannot, in any
   * environment.
   */
  it("never asks an agent to run the stage-round workflow", () => {
    const agentPrompts = [...CODE.matchAll(/agent\(\s*\[([\s\S]*?)\]\.join/g)].map((m) => m[1]);
    expect(agentPrompts.length).toBeGreaterThan(0);
    for (const prompt of agentPrompts) {
      // `.{0,3}` and not `.?` — in the source the name is wrapped in an ESCAPED
      // backtick, which is two characters (`\` then `` ` ``). The first draft of
      // this assertion used `.?`, matched neither, and passed against the very
      // source that carried the defect. Verified by running it against
      // `git show HEAD:…/stage-loop.mjs` before this comment was written.
      expect(prompt, "an agent is being told to run a workflow it has no runtime for").not.toMatch(
        /Run the .{0,3}crabgic-stage-round/,
      );
    }
  });

  /**
   * ⚠️ Measured by probe on 2026-08-17: `workflow("crabgic-stage-round")` throws
   * "no workflow with that name. Available: deep-research, code-review". A
   * plugin workflow is not in the name registry, so a by-name call is broken
   * wherever it runs — not a local misconfiguration.
   */
  it("never resolves the sibling workflow by NAME, which no environment supports", () => {
    expect(CODE).not.toMatch(/workflow\(\s*["'`]crabgic-stage-round/);
  });

  it("refuses when it is not told where stage-round is installed, rather than guessing a path", () => {
    // A guessed path either runs some other file or fails in a shape
    // indistinguishable from a round that reviewed everything and found nothing.
    expect(CODE).toMatch(/stageRoundPath/);
    expect(CODE).toMatch(/stageRoundPath is required/);
  });

  it("still refuses without a changeSetId", () => {
    expect(CODE).toMatch(/changeSetId is required/);
  });

  /**
   * A round that could not dispatch and a round that ran clean must never share
   * an outcome — that is how a broken loop reads as a stage nobody had findings
   * about.
   */
  it("distinguishes a failed dispatch from a round that found nothing", () => {
    expect(CODE).toMatch(/could not dispatch/);
    expect(CODE).toMatch(/produced no verdicts/);
  });
});

/**
 * Defect `25-stage-round-answers-no-criterion.md`: three real reviewers answered
 * every obligation and the server still refused closure with "an obligation went
 * unanswered", because `review.submit` counts a criterion as met only when it
 * carries an ATTESTATION, and nothing carried one.
 */
describe("the submit mapping (defect 25-stage-round-answers-no-criterion)", () => {
  const submitPrompt =
    [...CODE.matchAll(/agent\(\s*\[([\s\S]*?)\]\.join/g)]
      .map((m) => m[1] ?? "")
      .find((p) => p.includes("review.submit")) ?? "";

  it("has a submit step at all", () => {
    expect(submitPrompt.length).toBeGreaterThan(0);
  });

  it("maps the reviewers' answered obligations onto metCriteria", () => {
    expect(submitPrompt).toMatch(/metCriteria/);
    expect(submitPrompt).toMatch(/answeredObligations/);
  });

  /** Without this the server counts every obligation as unanswered and no stage ever closes. */
  it("passes the attestations through, stamped with the round the loop owns", () => {
    expect(submitPrompt).toMatch(/attestations/);
    expect(submitPrompt).toMatch(/assertedAt/);
    expect(submitPrompt).toMatch(/round/);
  });

  /**
   * The verdict is an OBJECT. Submitting it as a JSON string was observed being
   * rejected by the same server with "expected object, received string".
   */
  it("says the verdict is an object, not a JSON string", () => {
    expect(submitPrompt).toMatch(/OBJECT, never a JSON string/);
  });
});

/**
 * Defect `25-stage-loop-never-disposes-a-finding.md`, measured at TWENTY rounds:
 * `openBlocking` grew 3 -> 19 and the two blockers voiding the attestations at
 * round 19 were the same two raised at round 1. A stage that ever raised one
 * finding could never close, however completely the artifact was repaired.
 */
describe("the disposition step (defect 25-stage-loop-never-disposes-a-finding)", () => {
  const disposePrompt =
    [...CODE.matchAll(/agent\(\s*\[([\s\S]*?)\]\.join/g)]
      .map((m) => m[1] ?? "")
      .find((p) => p.includes("Dispose of the")) ?? "";

  it("has a disposition step at all", () => {
    expect(disposePrompt.length).toBeGreaterThan(0);
  });

  it("reads the open set from the SERVER's findings, not from its own memory of the round", () => {
    expect(CODE).toMatch(/openFindings/);
    expect(CODE).toMatch(/!finding\.disposition/);
  });

  it("offers all three dispositions, not just `fixed`", () => {
    for (const disposition of ["fixed", "refuted", "accepted-debt"]) {
      expect(disposePrompt).toContain(disposition);
    }
  });

  /** `review.submit` rejects a disposition with no evidence — "what stops a finding being filed and forgotten". */
  it("requires evidence with every disposition", () => {
    expect(disposePrompt).toMatch(/dispositionEvidence/);
  });

  /** Same id supersedes the recorded finding; a new id files a second one. */
  it("says the ORIGINAL finding id must be reused", () => {
    expect(disposePrompt).toMatch(/ORIGINAL/);
    expect(disposePrompt).toMatch(/a new id files a second finding/);
  });

  /**
   * ⚠️ THE ANTI-SYCOPHANCY GUARD. A step that marked everything `fixed` to make
   * the round pass is the shortcut the defect record explicitly refuses, and it
   * would manufacture the caller-grades-its-own-work property the review surface
   * exists to deny. Leaving a finding open is the fail-closed direction.
   */
  it("tells the disposer it may refuse, and that refusing holds the stage open", () => {
    expect(disposePrompt).toMatch(/Do NOT dispose of a finding you cannot verify/);
    expect(disposePrompt).toMatch(/holds the stage open/);
    expect(disposePrompt).toMatch(/Marking everything .?fixed.? to make/);
  });

  /** A fresh dispatch, so neither the reviewer nor the submitter disposes of its own work. */
  it("disposes from its own dispatch, distinct from the review and the submit", () => {
    expect(CODE).toMatch(/:dispose-/);
    expect(CODE).toMatch(/:submit-/);
  });

  /** Never runs on a stage the server already closed — there would be nothing to answer. */
  it("only runs while the stage is still open", () => {
    expect(CODE).toMatch(/if \(!closed && undisposed\.length > 0\)/);
  });
});

/**
 * Defect `25-stage-loop-runs-share-one-scratchpad.md`: two concurrent invocations
 * staged their verdicts at the same un-namespaced path and one agent read the
 * other's. It was caught only because that agent noticed and refused — which is
 * not a control, it is luck with good manners.
 */
describe("the submit step must not stage verdicts on disk", () => {
  const submitPrompt =
    [...CODE.matchAll(/agent\(\s*\[([\s\S]*?)\]\.join/g)]
      .map((m) => m[1] ?? "")
      .find((p) => p.includes("review.submit")) ?? "";

  it("tells the submitter to submit straight from its own message", () => {
    expect(submitPrompt).toMatch(/Submit STRAIGHT FROM THIS MESSAGE/);
    expect(submitPrompt).toMatch(/Do not stage the verdicts in a file/);
  });

  /** The reason, not just the rule — a bare prohibition is one a future editor removes. */
  it("says why, so the instruction survives an edit", () => {
    expect(submitPrompt).toMatch(/concurrent runs/);
  });
});

/**
 * Defect `25-plan-schema-strips-the-lens-reviewer.md`. A structured-output schema
 * drops every property it does not declare, so an incomplete `PLAN_SCHEMA` is a
 * SILENT EDIT of the server's plan — the exact hazard this loop's own docblock
 * names, arriving as an omission.
 */
describe("the plan schema must not truncate the server's plan", () => {
  const planSchema = SOURCE.slice(
    SOURCE.indexOf("const PLAN_SCHEMA"),
    SOURCE.indexOf("const SUBMIT_SCHEMA"),
  );

  /** `crabgic-stage-round`'s `reviewerFor` refuses a lens without it, so a plan missing it dispatches nothing. */
  it("declares the per-lens reviewer, and requires it", () => {
    expect(planSchema).toMatch(/reviewer: \{ type: "string" \}/);
    expect(planSchema).toMatch(/required: \["lens", "obligations", "reviewer"\]/);
  });

  /**
   * Derived from the sibling script rather than hard-coded: every `lens.<prop>`
   * that `stage-round.mjs` actually reads must be declared here, so adding a new
   * one there cannot silently truncate the plan again.
   */
  it("declares every lens property the round workflow reads", () => {
    const round = readFileSync(
      join(resolvePluginRoot(), "workflows", "stage-round.mjs"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const read = new Set(
      [...round.matchAll(/\blens\?\.(\w+)|\blens\.(\w+)/g)].map((m) => m[1] ?? m[2]),
    );
    for (const prop of read) {
      if (prop === "lens") continue; // the id itself, declared as `lens`
      expect(
        planSchema,
        `stage-round reads lens.${String(prop)}; PLAN_SCHEMA must declare it`,
      ).toContain(`${String(prop)}:`);
    }
  });
});

describe("what the loop must never decide for itself", () => {
  it("takes closure from the server's response, never from its own judgement", () => {
    // `stageClosable` is `review.submit`'s answer. A loop that computed it would
    // be the caller grading its own work.
    expect(CODE).toMatch(/dispatched\.stageClosable === true/);
  });

  it("reports reaching the round budget as a STALL, never as a closed stage", () => {
    expect(SOURCE).toMatch(/runaway guard/);
    expect(CODE).toMatch(/stalled = true/);
  });

  it("returns immediately for an owner-gated stage rather than looping on a human", () => {
    expect(CODE).toMatch(/ownerGated === true/);
    expect(CODE).toMatch(/awaitingOwner: true/);
  });

  it("passes the server's plan through unedited", () => {
    // Editing the roster is the one way this loop can lie about what was reviewed.
    expect(CODE).toMatch(/const roundPlan = \{ \.\.\.plan/);
  });
});

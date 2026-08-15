export const meta = {
  name: "crabgic-stage-loop",
  description:
    "Drives one Crabgic pipeline stage to closure: plan, dispatch a review round, submit the verdicts, repeat until the stage closes or the runaway guard stops it.",
  whenToUse:
    "To run a stage without supervising each round. Pass {completedStages, stackEvidence, artifactRef, changeSetId}. Owner-gated stages return immediately — they close on the owner, not on a round.",
  phases: [
    { title: "Plan", detail: "ask the server what runs next" },
    { title: "Round", detail: "dispatch the lenses and submit their verdicts" },
  ],
};

/**
 * THE MULTI-ROUND LOOP — roadmap/25 work item 7, the last orchestration piece.
 *
 * `stage-round.mjs` runs ONE round. `pipeline.plan` says what a round should
 * contain. `review.submit` says whether the stage may close. Until this existed,
 * the thing that tied those three together was a paragraph in a skill telling
 * the manager to repeat — which is the same "prose a model may skip" the audit
 * that produced this phase was written about, one level up.
 *
 * WHAT THIS OWNS: how many times to go round, and when to stop.
 * WHAT IT DOES NOT OWN: what a round contains (the server's), and whether the
 * stage closes (the server's). It asks, it dispatches, it reports. A loop that
 * decided its own exit would be the caller grading its own work, which is the
 * one property every other piece of this pipeline is built to deny.
 *
 * THE GUARD IS NOT THE CLOSURE RULE. A stage closes on a round that raises no
 * admissible novel finding. Reaching `roundBudget` means the loop STALLED, and
 * this reports it as such — never as a stage that finished.
 */

const input = args ?? {};
const completedStages = Array.isArray(input.completedStages) ? input.completedStages : [];
const changeSetId = typeof input.changeSetId === "string" ? input.changeSetId : "";
const artifactRef = typeof input.artifactRef === "string" ? input.artifactRef : "";

if (changeSetId.length === 0) {
  // Refused rather than defaulted. Every server call below is scoped to a change
  // set, and inventing one would submit a real review against the wrong work.
  log("no changeSetId supplied — refusing to run a stage against an unknown change set");
  return { ok: false, error: "changeSetId is required" };
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    error: { type: "string" },
    finished: { type: "boolean" },
    stage: { type: "string" },
    ownerGated: { type: "boolean" },
    roundBudget: { type: "number" },
    lenses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lens: { type: "string" },
          obligations: { type: "array", items: { type: "string" } },
        },
        required: ["lens", "obligations"],
      },
    },
    skippedLenses: {
      type: "array",
      items: {
        type: "object",
        properties: { lens: { type: "string" }, reason: { type: "string" } },
        required: ["lens", "reason"],
      },
    },
  },
  required: ["ok"],
};

const SUBMIT_SCHEMA = {
  type: "object",
  properties: {
    stageClosable: { type: "boolean" },
    closureReason: { type: "string" },
    escalate: { type: "boolean" },
    escalationReason: { type: "string" },
    lensesSubmitted: { type: "number" },
  },
  required: ["stageClosable", "lensesSubmitted"],
};

phase("Plan");

const plan = await agent(
  [
    "Call the `pipeline.plan` gateway tool and return its result verbatim.",
    "",
    `completedStages: ${JSON.stringify(completedStages)}`,
    `stackEvidence: ${JSON.stringify(input.stackEvidence ?? null)}`,
    "",
    "Return exactly what the tool returned. Do not add lenses, remove lenses,",
    "or edit an obligation list — the plan is the server's answer, and editing",
    "it is the one way this loop can be made to lie about what was reviewed.",
  ].join("\n"),
  { label: "plan", phase: "Plan", schema: PLAN_SCHEMA },
);

if (plan === null || plan.ok !== true) {
  // A refused plan is usually a skipped stage: `pipeline.plan` names the stage
  // that was jumped. Surfaced rather than retried, because retrying the same
  // completion set gets the same refusal.
  const error = plan?.error ?? "pipeline.plan returned nothing";
  log(`cannot plan: ${error}`);
  return { ok: false, error };
}

if (plan.finished === true) {
  log("every stage is complete");
  return { ok: true, finished: true };
}

const stage = plan.stage ?? "unknown";

if (plan.ownerGated === true) {
  /**
   * `clarify` and `design-gate` close on the owner. There is no loop to run on
   * a human — looping is the "shall I proceed?" check-in the manager protocol
   * forbids — so this returns and lets the manager render what is waiting.
   */
  log(`stage ${stage} is owner-gated — returning for the owner to answer`);
  return { ok: true, stage, ownerGated: true, awaitingOwner: true };
}

const budget = typeof plan.roundBudget === "number" ? plan.roundBudget : 20;
let round = 1;
let closed = false;
let lastReason = "no round has run yet";
let stalled = false;
const rounds = [];

phase("Round");

while (round <= budget && !closed) {
  const roundPlan = { ...plan, artifactRef, round };

  const dispatched = await agent(
    [
      `Run the \`crabgic-stage-round\` workflow for round ${String(round)} of the`,
      `\`${stage}\` stage, passing this plan verbatim as its args:`,
      "",
      JSON.stringify(roundPlan),
      "",
      "Then submit EVERY verdict it returns through the `review.submit` gateway",
      `tool, one call per lens, with stage "${stage}" and changeSetId`,
      `"${changeSetId}". Submit them exactly as the workflow returned them.`,
      "",
      "Return the LAST `review.submit` response, plus how many lenses you",
      "submitted. Do not decide whether the stage closed — report what the",
      "server said. A lens the workflow reported as `unrun` still counts as not",
      "submitted, and you must say so rather than quietly submitting fewer.",
    ].join("\n"),
    { label: `${stage}:round-${String(round)}`, phase: "Round", schema: SUBMIT_SCHEMA },
  );

  if (dispatched === null) {
    // A dead round is not a clean round. Continuing would let a crashed
    // dispatch look like a round that found nothing.
    lastReason = `round ${String(round)} returned nothing — the dispatch failed`;
    log(lastReason);
    break;
  }

  rounds.push({
    round,
    lensesSubmitted: dispatched.lensesSubmitted ?? 0,
    stageClosable: dispatched.stageClosable === true,
    reason: dispatched.closureReason ?? "",
  });

  closed = dispatched.stageClosable === true;
  lastReason = dispatched.closureReason ?? (closed ? "closed" : "no reason given");

  if (dispatched.escalate === true) {
    // The server said this loop stalled. Continuing would burn the rest of the
    // budget on a stage that has stopped converging.
    stalled = true;
    lastReason = dispatched.escalationReason ?? lastReason;
    log(`escalating: ${lastReason}`);
    break;
  }

  round += 1;
}

if (!closed && !stalled && round > budget) {
  // Reaching the guard is a STALL, not a close. Reporting it as anything else
  // is the syntactic kill-switch wearing a verdict's clothes.
  stalled = true;
  lastReason = `the runaway guard stopped this stage at round ${String(budget)} without closing it`;
}

log(
  `stage ${stage}: ${closed ? "CLOSED" : stalled ? "STALLED" : "did not close"} after ${String(
    rounds.length,
  )} round(s)`,
);

return {
  ok: true,
  stage,
  closed,
  stalled,
  reason: lastReason,
  roundsRun: rounds.length,
  rounds,
  skippedLenses: plan.skippedLenses ?? [],
};

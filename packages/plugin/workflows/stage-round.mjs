export const meta = {
  name: "crabgic-stage-round",
  description:
    "Runs one round of one Crabgic pipeline stage: fan out every applicable lens, then verify each finding.",
  whenToUse:
    "After `pipeline.plan` returns a stage plan. Pass that plan verbatim as args. Not for owner-gated stages — those close on the owner, not on a review round.",
  phases: [
    { title: "Review", detail: "one reviewer per applicable lens, in parallel" },
    { title: "Verify", detail: "adversarially verify each finding as its lens finishes" },
  ],
};

/**
 * ONE ROUND OF ONE STAGE — roadmap/25 work item 7.
 *
 * This is the piece that actually DISPATCHES. `pipeline.plan` decides what
 * should run; this runs it. Until this existed, every lens the plan named was a
 * review nobody performed.
 *
 * WHY IT TAKES THE PLAN AS `args` RATHER THAN COMPUTING IT. A workflow script
 * has no imports and no filesystem access, so it cannot read `PIPELINE_STAGES`,
 * `DOMAIN_LENSES` or a stage's exit criteria. Recomputing any of that here would
 * mean inlining a second copy of a list that must agree with the first — the
 * failure this repository has measured twice — planted at the exact point that
 * decides what gets reviewed. So the server decides and this obeys.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not decide whether the stage closes.
 * Closure is `review.submit`'s, computed server-side from findings on record. A
 * script that returned "closed" would be the caller grading its own work, which
 * is the one thing the whole review surface is built to prevent.
 */

const plan = args ?? {};
const lenses = Array.isArray(plan.lenses) ? plan.lenses : [];
const stage = typeof plan.stage === "string" ? plan.stage : "unknown";
const artifactRef = typeof plan.artifactRef === "string" ? plan.artifactRef : stage;
const round = typeof plan.round === "number" ? plan.round : 1;

if (plan.ownerGated === true) {
  // Owner-gated stages close on the owner's recorded verdict and on nothing
  // else. Dispatching a reviewer here would manufacture a second route to
  // closure, which is the difference between a gate and a checkpoint.
  log(`stage ${stage} is owner-gated — no review round to run`);
  return { stage, dispatched: 0, ownerGated: true, verdicts: [] };
}

if (lenses.length === 0) {
  // An empty lens list is not "nothing to do": it means the plan named no
  // reviewer for a stage that should have had one. Returning quietly would let
  // the round look complete.
  log(`stage ${stage} planned NO lenses — nothing was reviewed`);
  return { stage, dispatched: 0, lensesPlanned: 0, verdicts: [] };
}

/**
 * WHICH SUBAGENT A LENS GOES TO — read from the plan, never guessed here.
 *
 * Until 2026-08-16 this script hardcoded `eo-domain-reviewer` for every lens of
 * every stage. Only `audit` plans domain lenses; `research`, `design`, `plan`,
 * `implement` and `document` plan PIPELINE lenses, which are `eo-reviewer`'s
 * charter — so nine of the shipped lens names went to a reviewer whose own
 * definition does not list them, and `eo-reviewer` was dispatched by nothing.
 *
 * A script cannot fix that itself: no imports means no `DOMAIN_LENS_IDS` to tell
 * the families apart. `planStageRound` derives it and the plan carries it, for
 * the same reason the plan already carries the lens list. An unlabelled lens is
 * refused rather than defaulted — defaulting is what produced the defect.
 */
function reviewerFor(lens) {
  const reviewer = lens?.reviewer;
  if (reviewer !== "eo-reviewer" && reviewer !== "eo-domain-reviewer") {
    throw new Error(
      `lens ${String(lens?.lens)} carries no reviewer — pipeline.plan is older than this workflow`,
    );
  }
  return reviewer;
}

const skipped = Array.isArray(plan.skippedLenses) ? plan.skippedLenses : [];
if (skipped.length > 0) {
  // Stated, never silent. A lens that did not apply is visible with its reason,
  // so "we audited it" can never quietly mean five of the six domains.
  log(`skipped ${String(skipped.length)} lens(es): ${skipped.map((s) => s.lens).join(", ")}`);
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    lens: { type: "string" },
    verdict: { type: "string", enum: ["approve", "revise"] },
    answeredObligations: { type: "array", items: { type: "string" } },
    /**
     * ⚠️ REQUIRED, and the reason a stage can close at all. `review.submit`
     * treats a bare id in `metCriteria` as NOT met: a judged criterion needs an
     * attestation naming who asserts it, why, and where in the artifact to look,
     * and anything unattested comes back in `unattestedCriteria`.
     *
     * Until 2026-08-17 this schema asked only for `answeredObligations`, so the
     * loop reported every obligation answered and the server correctly refused
     * closure with "an obligation went unanswered" — the reviewers' answers were
     * never in a form the server could count. Defect
     * `25-stage-round-answers-no-criterion.md`.
     */
    attestations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          asserter: { type: "string" },
          rationale: { type: "string" },
          artifactAnchor: { type: "string" },
        },
        required: ["criterion", "asserter", "rationale", "artifactAnchor"],
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
          classification: { type: "string", enum: ["blocking", "advisory"] },
          /**
           * ⚠️ REQUIRED, because `review.submit` REFUSES a blocking finding that
           * names no exit criterion: "a blocking finding must name the exit
           * criterion it violates; one that violates no stated criterion is
           * advisory". Declared optional here until 2026-08-17, so a reviewer's
           * blocking finding was rejected at the wire and never journaled — the
           * lens's whole round lost. Defect `25-blocking-finding-needs-violates.md`.
           *
           * Required for EVERY finding rather than only for blocking ones: an
           * advisory that names its criterion costs nothing, and a conditionally
           * required field is one a reviewer omits on the branch that matters.
           */
          violates: { type: "string" },
          evidence: {
            type: "object",
            properties: {
              reproduction: { type: "string" },
              observed: { type: "string" },
              expected: { type: "string" },
            },
            required: ["reproduction", "observed", "expected"],
          },
        },
        required: ["claim", "paths", "classification", "violates", "evidence"],
      },
    },
  },
  required: ["lens", "verdict", "answeredObligations", "attestations", "findings"],
};

const CONFIRMATION_SCHEMA = {
  type: "object",
  properties: {
    stands: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["stands", "why"],
};

function reviewPrompt(lens) {
  const obligations = Array.isArray(lens.obligations) ? lens.obligations : [];
  return [
    `You are the \`${lens.lens}\` lens reviewing the \`${stage}\` stage of ${artifactRef}.`,
    `This is round ${String(round)}.`,
    "",
    "Answer ONLY your lens's question. The other lenses are running beside you;",
    "duplicating them costs a round and adds no perspective.",
    "",
    "OBLIGATIONS — answer every one explicitly, including the ones where the",
    "answer is 'nothing to report'. An obligation you skip is treated as UNMET",
    "server-side and holds this stage open, so silence stalls the stage rather",
    "than passing it. List every obligation id you answered in",
    "`answeredObligations`.",
    "",
    "ATTESTATIONS — for every obligation you answered and found MET, add an",
    "entry to `attestations` with:",
    "  - `criterion`: the obligation id, exactly as issued;",
    "  - `asserter`: your lens name;",
    "  - `rationale`: why it is met, in your own words — not a restatement of",
    "    the criterion;",
    "  - `artifactAnchor`: where in the artifact you looked (a path, a heading,",
    "    or a path:line).",
    "An obligation listed in `answeredObligations` with no attestation counts as",
    "NOT MET server-side, because a bare id is a claim with nothing behind it.",
    "Do NOT attest an obligation you found unmet — raise a finding instead.",
    "",
    ...obligations.map((o) => `  - ${o}`),
    "",
    "EVERY finding must name, in `violates`, the exit-criterion id it breaks —",
    "one of the obligation ids above. The server REFUSES a blocking finding that",
    "names none, and the whole verdict is lost with it. If a finding breaks no",
    "stated criterion, it is advisory by definition, and it still names the",
    "criterion it bears on.",
    "",
    "ADMISSIBILITY — a finding counts only if it:",
    "  - names the repository paths it concerns (a pathless finding is deferred);",
    "  - concerns a path this change set actually writes;",
    "  - has not been raised before (rewording does not make it new);",
    "  - carries an executed reproduction: these inputs, that wrong result.",
    "",
    "Severity does not decide whether the loop continues. An advisory holds the",
    "stage open exactly as a blocker does. `blocking` requires naming the exit",
    "criterion it violates; if it violates none, it is `advisory` and still real.",
    "",
    "Do not re-decide what a deterministic gate decides (build, types, tests,",
    "coverage). `approve` is a real answer — if it holds up, say so and name what",
    "you checked.",
  ].join("\n");
}

phase("Review");

/**
 * `pipeline()` rather than `parallel()` + a barrier: each lens's findings go to
 * verification the moment that lens finishes, instead of every lens waiting for
 * the slowest. Nothing in verification needs cross-lens context — a finding is
 * confirmed or refuted on its own evidence.
 */
const results = await pipeline(
  lenses,
  (lens) =>
    agent(reviewPrompt(lens), {
      label: `${stage}:${lens.lens}`,
      phase: "Review",
      schema: VERDICT_SCHEMA,
      agentType: reviewerFor(lens),
    }),
  async (verdict, lens) => {
    if (verdict === null) {
      // A dead agent is not an approval. Returning null here would let the
      // caller treat a crashed lens as a lens that found nothing.
      log(`lens ${lens.lens} returned nothing — treat as unrun`);
      return { lens: lens.lens, unrun: true };
    }
    const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
    if (findings.length === 0) return verdict;

    /**
     * Each finding is put to an independent skeptic prompted to REFUTE it. A
     * finding that survives an attempt to break it is worth a repair attempt;
     * one that does not would have cost the stage a round for nothing.
     */
    const checked = await parallel(
      findings.map(
        (finding) => () =>
          agent(
            [
              `Try to REFUTE this finding from the \`${verdict.lens}\` lens:`,
              "",
              `Claim: ${String(finding.claim)}`,
              `Paths: ${(finding.paths ?? []).join(", ")}`,
              `Reproduction: ${String(finding.evidence?.reproduction ?? "")}`,
              `Observed: ${String(finding.evidence?.observed ?? "")}`,
              `Expected: ${String(finding.evidence?.expected ?? "")}`,
              "",
              "Read the code and decide whether the reproduction actually produces",
              "the observed result for the stated reason. Default to `stands: false`",
              "if you are uncertain — an unverified finding costs a repair attempt,",
              "and a false one costs the stage a whole round.",
            ].join("\n"),
            {
              label: `verify:${verdict.lens}`,
              phase: "Verify",
              schema: CONFIRMATION_SCHEMA,
              agentType: reviewerFor(lens),
            },
          ).then((confirmation) => ({
            ...finding,
            verification: confirmation?.stands === true ? "confirmed" : "refuted",
            verificationNote: confirmation?.why ?? "verifier returned nothing",
          })),
      ),
    );
    return { ...verdict, findings: checked.filter(Boolean) };
  },
);

const verdicts = results.filter(Boolean);
const unrun = verdicts.filter((v) => v.unrun === true).map((v) => v.lens);
if (unrun.length > 0) {
  // Surfaced rather than absorbed: an unrun lens is an unanswered obligation,
  // and the stage must not be reported as reviewed.
  log(`UNRUN lenses (their obligations are unanswered): ${unrun.join(", ")}`);
}

log(
  `stage ${stage} round ${String(round)}: ${String(verdicts.length - unrun.length)}/${String(
    lenses.length,
  )} lenses returned a verdict`,
);

/**
 * Returned for the caller to submit through `review.submit`, one verdict per
 * lens. This script does NOT submit them itself and does not say whether the
 * stage closes: closure is computed server-side from findings on record, and a
 * script that answered it would be the caller grading its own work.
 */
return {
  stage,
  round,
  lensesPlanned: lenses.length,
  lensesRun: verdicts.length - unrun.length,
  unrun,
  skipped,
  verdicts: verdicts.filter((v) => v.unrun !== true),
};

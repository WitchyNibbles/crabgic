import {
  CONTRACT_SECTIONS,
  DEFAULT_PRESENTATION_POLICY,
  PRESENTATION_GLYPH_ROLES,
  REVIEW_RUNAWAY_GUARD,
  glyph,
} from "@crabgic/contracts";

/**
 * The manager session's operating protocol — roadmap/10-plugin-and-installer.md
 * (managed `CLAUDE.md` block) and roadmap/11-intake-contract-approval.md (the
 * seven stop conditions).
 *
 * WHY THIS EXISTS. The installer's managed `CLAUDE.md` block used to be a
 * feature list — "here are your slash commands, here are your subagents" — and
 * said nothing about how to operate. With no instruction to the contrary a
 * Claude Code session falls back to its conversational default and checks in
 * after every step, which is the exact opposite of what this product is: an
 * orchestrator whose own design (roadmap/11) names SEVEN conditions that halt a
 * run, none of which is "the owner has not said `continue` recently". Two
 * defects were reported from real use in a consuming repo:
 *
 *   1. the manager asked the owner to type "continue" after every step;
 *   2. when it did have a real question, it rendered the choices as a
 *      plain-text "option 1 / 2 / 3 / 4" list instead of using the engine's
 *      structured question tool;
 *   3. it reported in long, unordered prose. The owner has a condition that
 *      makes that hard to read, so this one is an accessibility defect, not
 *      a matter of taste — the reporting rules and the glyph vocabulary come
 *      from `PresentationPolicy` (`@crabgic/contracts`), documented in
 *      `docs/presentation-policy.md`.
 *
 * All three are addressed here, in prose, because all are model behavior. Prose is
 * not enforcement, which is why `hooks/stop-autonomy-gate.mjs` exists as the
 * deterministic second layer: this module says what should happen, that hook
 * makes the "don't stop mid-run" half actually stick.
 *
 * SINGLE SOURCE OF TRUTH. This module is the only place the protocol text is
 * written. `packages/cli/src/installer/claude-md.ts` renders it into the
 * managed block, and `skills/protocol/SKILL.md` carries the long-form
 * rationale. Do not restate any of it in a second location.
 */

/**
 * The engine's structured-question tool.
 *
 * Engine fact, cited per the project's ground rule: `docs/engine-baseline.md`
 * §18. §18.1 establishes (probe-verified, both transports) that this tool is
 * ABSENT from the headless catalog — which is what makes "a worker can never
 * block a run waiting on a human" true by construction. §18.2 records its
 * presence in an INTERACTIVE session — the manager's context — as an in-session
 * observation that is explicitly NOT probe-verified. The protocol text below
 * therefore degrades gracefully if the tool turns out to be absent; nothing
 * shipped depends on §18.2 resolving PASS.
 */
export const QUESTION_TOOL_NAME = "AskUserQuestion";

/**
 * The gateway tool that renders a policy-conforming report
 * (`packages/cli/src/gateway-mcp/report-tool-definition.ts`).
 *
 * Named here so the protocol block can point at it: a rendering path the
 * manager does not know about is a rendering path it will not use, which is the
 * whole failure mode design §L1 exists to fix.
 */
export const REPORT_TOOL_NAME = "report.render";

/**
 * The gateway tool that decides what the pipeline runs next
 * (`packages/cli/src/review/pipeline-plan-handler.ts`).
 *
 * roadmap/25 work item 7 moved stage order, lens coverage, obligation
 * checklists and round budgets OUT of prose and onto the server, because prose
 * sequencing is a suggestion a model may skip — which is the complaint that
 * whole phase was written against. Naming the tool here is what makes the move
 * reach the session: a manager that has never heard of `pipeline.plan` will
 * reconstruct a stage order from the loop rules it CAN see, and arrive back at
 * the defect by being reasonable rather than by being careless.
 */
export const PIPELINE_PLAN_TOOL_NAME = "pipeline.plan";

/**
 * The `Workflow` script that drives the rounds
 * (`packages/plugin/workflows/stage-loop.mjs`).
 *
 * It owns HOW MANY TIMES to go round, and nothing else: what a round contains
 * is `PIPELINE_PLAN_TOOL_NAME`'s, and whether the stage may close is
 * `review.submit`'s. A loop that decided its own exit would be the caller
 * grading its own work.
 */
export const STAGE_LOOP_WORKFLOW_NAME = "crabgic-stage-loop";

/**
 * The reporting half of the protocol reads its numbers and its glyph
 * vocabulary from `@crabgic/contracts`' `PresentationPolicy` rather than
 * restating them, for the same reason phase 17's templates read their
 * lengths from `CommunicationPolicy` at call time: a limit that exists in
 * two places drifts. `docs/presentation-policy.md` holds the rationale.
 */
const REPORT_LIMITS = DEFAULT_PRESENTATION_POLICY.limits;

export interface ManagerStopCondition {
  /**
   * The supervisor's own kind string. Deliberately identical to a member of
   * `STOP_CONDITION_KINDS` in `@crabgic/supervisor`'s
   * `src/intake/stop-conditions.ts` — the parity is asserted by a test in
   * `packages/cli` (the one package that already depends on both, so this
   * package needs no new graph edge to stay honest).
   */
  readonly kind: string;
  /** What a human reads. Never the snake_case id. */
  readonly label: string;
  /** The concrete trigger, phrased so the model can recognize the situation it is in. */
  readonly whenItFires: string;
  /**
   * True only for the one condition that is a QUESTION rather than a HALT.
   * The other six stop the run and report; this one opens a decision for the
   * owner, and is the case `QUESTION_TOOL_NAME` exists to serve.
   */
  readonly asksTheHuman: boolean;
}

/** roadmap/11 §In scope, "Stop conditions enforced" — in the supervisor's own order. */
export const MANAGER_STOP_CONDITIONS: readonly ManagerStopCondition[] = [
  {
    kind: "material_amendment",
    label: "material amendment",
    whenItFires:
      "the work has diverged from the approved contract in a way that changes what is being built",
    asksTheHuman: false,
  },
  {
    kind: "expanded_authority",
    label: "expanded authority",
    whenItFires:
      "finishing would need a command, path, network destination or credential the approved envelope does not grant",
    asksTheHuman: false,
  },
  {
    kind: "critical_security_issue",
    label: "critical security issue",
    whenItFires:
      "a vulnerability or exposed secret is found that must not be papered over to keep moving",
    asksTheHuman: false,
  },
  {
    kind: "unsafe_overlap",
    label: "unsafe overlap",
    whenItFires:
      "two in-flight work units would write the same region and the conflict cannot be ordered away",
    asksTheHuman: false,
  },
  {
    kind: "irreducible_product_decision",
    label: "irreducible product decision",
    whenItFires:
      "two defensible options lead to materially different products and no amount of reading the repo decides between them",
    asksTheHuman: true,
  },
  {
    kind: "exhausted_repairs",
    label: "exhausted repairs",
    whenItFires:
      "the initial attempt plus both evidence-driven repair attempts have been spent on the same work unit",
    asksTheHuman: false,
  },
  {
    kind: "blocking_verification",
    label: "blocking verification",
    whenItFires: "a quality or security gate fails in a way that no repair attempt can clear",
    asksTheHuman: false,
  },
];

/**
 * The `IntentContract`'s nine sections, which double as the clarify loop's
 * exit condition.
 *
 * The loop needs a CHECKABLE termination rule or it either interrogates forever
 * or stops early on a hunch. These sections already are that checklist — the
 * contract cannot be built until every one of them is answerable.
 *
 * RE-EXPORTED, not restated (2026-07-29). This module carried its own
 * hand-written copy of the nine names, which is a second list that must agree
 * with the schema's. Rounds 4-7 established what happens to two lists that must
 * agree: they diverge, and the last attempt to keep them in step made
 * mismatches six times worse. `@crabgic/contracts` derives the array from
 * `IntentContractSectionsSchema`'s own keys, so adding a section there adds it
 * here with no second edit.
 */
export { CONTRACT_SECTIONS } from "@crabgic/contracts";

/**
 * The three artifacts a review round covers (ledger Gap 19, amended 2026-07-29).
 *
 * Deliberately these three and not "the work": each is reviewable on its own
 * terms and at its own moment, and a review of the test suite in particular is
 * not a gate verdict and never substitutes for one.
 */
export const REVIEW_ARTIFACTS = ["the design", "the tests", "the implementation"] as const;

/**
 * The reviewer's verdict vocabulary.
 *
 * `approve` existing at all is the amendment. The superseded charter told the
 * reviewer "do not approve it", which left it no way to say *done* — and a
 * reviewer that cannot say done cannot terminate a loop. Measured over twelve
 * rounds that never converged; see `docs/staged-review-pipeline.md` §2.
 */
export const REVIEW_VERDICTS = ["approve", "revise"] as const;

/**
 * What must happen to every finding before its stage may advance.
 *
 * The severity floor gates the LOOP, never the LEDGER (ledger Gap 19 part 4 as
 * amended). A finding too minor to block is still verified, still answered and
 * still recorded — `advisory` is a deferral, never a disposal route — so this
 * list has no "ignored" member by design.
 */
export const FINDING_DISPOSITIONS = ["fixed", "refuted", "accepted-debt"] as const;

/**
 * The hard ceiling on review rounds for one stage.
 *
 * The real bound is progress: a stage loops while each round closes at least
 * one blocking finding and escalates the moment one closes none. This ceiling
 * exists only so a pathological stage cannot run forever if progress is
 * mis-measured — the literature's caution that a fixed cap is a "syntactic
 * kill-switch" is why it is the backstop rather than the rule.
 */
export const REVIEW_ROUND_CEILING = 5;

/**
 * The runaway guard is IMPORTED from `@crabgic/contracts` rather than restated
 * here, unlike `REVIEW_ROUND_CEILING` above.
 *
 * The ceiling's duplication is a pre-existing wart this ruling does not widen:
 * two copies of a number that decides when a loop stops is exactly the drift
 * `normalizePlannedPath` was centralized to avoid, and adding a second copy of
 * the guard while amending the rule would have been the same mistake made
 * knowingly. The protocol text below renders the imported value.
 */

export interface ManagerApprovalGate {
  /** The exact command a human types. */
  readonly trigger: string;
  readonly what: string;
}

/**
 * The human-approval gates. These are NOT stop conditions — they are points
 * where the design requires a human act, and the model is structurally unable
 * to satisfy them on its own (adaptation §5.5: "the model must not be able to
 * satisfy its own approval gate"). The manager's job at a gate is to render
 * what is under review and then wait; it never nudges, and never re-asks.
 */
export const MANAGER_APPROVAL_GATES: readonly ManagerApprovalGate[] = [
  {
    trigger: "/eo:approve",
    what: "the contract, plan and authorization envelope for a change set",
  },
  { trigger: "crabgic trust review", what: "a high-impact capability grant held in quarantine" },
  {
    trigger: "crabgic learn approve",
    what: "promotion of a learning proposal — twice, on two separate invocations",
  },
  /**
   * roadmap/25 work item 5, owner ruling R2 — added 2026-08-16.
   *
   * The enforcement shipped 2026-08-15: `resolveDesignGate` REPLACES the
   * closure rule for the `design-gate` stage, the verdict store is CLI-write
   * only, and the gateway deliberately exposes no tool that can record one. All
   * of that was already true while this roster still had three entries — so the
   * one place the manager session is TOLD the gate exists did not mention it.
   *
   * A gate nobody announces is a gate the session runs into without being able
   * to name: it renders the design, gets a closure refusal it has no vocabulary
   * for, and either loops the design stage pointlessly or reports a stall. The
   * gate is placed here rather than in the stop conditions for the same reason
   * the other three are — it is a human ACT the model is structurally unable to
   * satisfy, not a condition that halts a run.
   */
  {
    trigger: "crabgic design approve",
    what: "the design for a change set, before any work unit is dispatched",
  },
];

/**
 * The glyph vocabulary, rendered as fixed rows of five. Fixed-width rows
 * rather than a single joined line because this text lands in a consuming
 * repo's `CLAUDE.md`, where a 200-character line is exactly the kind of
 * thing the policy it describes exists to prevent — and because a wrap
 * computed from the terminal would make the block non-deterministic, which
 * the installer's byte-preserving merge forbids.
 */
const GLYPHS_PER_ROW = 5;

function renderGlyphVocabulary(): string {
  const entries = PRESENTATION_GLYPH_ROLES.map((role) => `${glyph(role, "emoji")} ${role}`);
  const rows: string[] = [];
  for (let index = 0; index < entries.length; index += GLYPHS_PER_ROW) {
    rows.push(entries.slice(index, index + GLYPHS_PER_ROW).join(" · "));
  }
  return rows.join("\n");
}

function renderStopConditions(): string {
  return MANAGER_STOP_CONDITIONS.map((condition) => {
    const suffix = condition.asksTheHuman ? " — ASK the owner, see below" : "";
    return `- **${condition.label}** — ${condition.whenItFires}${suffix}`;
  }).join("\n");
}

/**
 * The compact, always-loaded protocol. Kept deliberately short: it sits in the
 * consuming repo's `CLAUDE.md` and is paid for on every manager turn. The long
 * rationale lives in the on-demand `protocol` skill; this is the part that has
 * to be in context whether or not the model chooses to go read anything.
 *
 * Deterministic and free of trailing whitespace — the installer's merge is
 * byte-preserving and drift-detected, so an unstable string here would show up
 * as spurious drift in every consuming repo.
 */
export function buildManagerProtocolBlock(): string {
  const gates = MANAGER_APPROVAL_GATES.map((gate) => `\`${gate.trigger}\` (${gate.what})`).join(
    ", ",
  );

  return `## Operating protocol

You are the manager of an autonomous orchestrator. Drive work to completion on
your own initiative. Progress is the default; stopping is what needs a reason.

**Never ask the owner for permission to keep going.** Do not ask "continue?",
"shall I proceed?", or "ready for the next step?". Do not describe a plan and
then wait to be told to run it. Do the work, then report what you did — not
what you are about to do. Being autonomous is the product; a check-in that
carries no decision is a defect.

**Research before you ask, and keep looping.** Read the code and the prior
art first; ask only what reading cannot answer; then research the answer and
ask again. Close the loop on a checkable condition, never a feeling: every
contract section (${CONTRACT_SECTIONS.join(", ")}) answerable,
and every requirement carrying testable acceptance criteria. Then stop asking
and build.

**Review your own work adversarially: ${REVIEW_ARTIFACTS.join(", ")}.**
Read-only, a **fresh** reviewer per round, and never a repair attempt — it spends
none of \`exhausted_repairs\`' three. A finding is admissible only if **novel**
and **falsifiable**: these inputs, that wrong result. Taste is not.

**A reviewer returns \`${REVIEW_VERDICTS.join("` or `")}\`.** Close a stage when its
written **exit criteria** are met and the round raises **no admissible novel
finding** — severity plays no part, so a new \`advisory\` holds it open like a
blocker. Admissible: concerns a path this change set **writes**, and not raised
before; anything else is debt. Only a finding that **names the exit criterion it
violates** may block. Never re-decide what a **gate** decides. Every finding gets
a disposition (\`${FINDING_DISPOSITIONS.join("`, `")}\`) whatever its severity, and a
stage **may not advance** holding one without; \`advisory\` defers, never disposes. Journal \`accepted-debt\` against the paths
it concerns; it turns \`blocking\` when a later change set **touches** that code.
Round ${String(REVIEW_RUNAWAY_GUARD)} is a runaway guard: reaching it means the loop **stalled**; escalate.

**Do not decide what runs next — ask.** Stage order, applicable lenses and round
budget are the server's, never yours: call \`${PIPELINE_PLAN_TOOL_NAME}\`, then run
\`${STAGE_LOOP_WORKFLOW_NAME}\`. Pass the plan back **as it came** — editing it makes this loop lie.

**Stop for exactly these, and nothing else:**

${renderStopConditions()}

Plus the approval gates, which are a human act by design and which you can
never satisfy yourself: ${gates}. At a gate, render what is under review, then
wait. Do not nudge, and do not re-ask.

**When you do have to ask, use the ${QUESTION_TOOL_NAME} tool.** Never a
plain-text numbered list ("1 / 2 / 3 / 4") — that is not how this harness asks.
Put every open decision into ONE call (up to 4 questions), give each question
2-4 concrete options, and make each option's description state the real
trade-off rather than restating the label. The interface supplies its own
"Other" choice and a free-text notes field, so never hand-roll either.
If ${QUESTION_TOOL_NAME} is unavailable, ask ONE consolidated question in
prose and carry on — never a step-by-step interrogation.

**Report so it can be read at a glance.** The owner has a condition that
makes long, unordered prose hard to read — an accessibility requirement,
not a style preference. Answer first, in ≤${REPORT_LIMITS.leadAnswerMaxLines} lines. Past ${REPORT_LIMITS.headingRequiredAboveLines} lines use
\`##\` headings. Never write more than ${REPORT_LIMITS.proseBlockMaxLines} unbroken prose lines. Prefer bullets
(≤${REPORT_LIMITS.bulletMaxWords} words, ≤${REPORT_LIMITS.sectionMaxBullets} per section) over paragraphs, and once ${REPORT_LIMITS.tableMinRows}+ items each
carry two or more attributes, make it a table. Stay brief unless the owner
asks for detail — and format the long answer too.

**Say less.** No preamble, no recap, no closer. Park tangents as named
follow-ups. Carry progress across turns (\`step 3 of 5\`); end on one next action.
Past a few lines call \`${REPORT_TOOL_NAME}\` and return its output verbatim.

Signpost state with these glyphs and no others; they are navigation aids, not decoration:

${renderGlyphVocabulary()}

Flat monochrome text is as hard to hold onto as unstructured text, so carry
contrast too. You cannot emit terminal colour here — weight is your channel:
**bold** the verdict and the numbers that matter, wrap every identifier, path
and command in \`code\`, and let the glyphs above carry the rest.

None of this reaches shared artifacts: PR, commit, Jira and Grafana text
stays neutral and emoji-free under the renderer's own policy.`;
}

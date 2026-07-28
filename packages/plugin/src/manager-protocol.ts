import { DEFAULT_PRESENTATION_POLICY, PRESENTATION_GLYPH_ROLES, glyph } from "@crabgic/contracts";

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
 * The `IntentContract`'s nine sections (roadmap/11 §In scope, "Contract
 * assembly"), which double as the clarify loop's exit condition.
 *
 * The loop needs a CHECKABLE termination rule or it either interrogates
 * forever or stops early on a hunch. These sections already are that
 * checklist — the contract cannot be built until every one of them is
 * answerable — so the protocol names them rather than inventing a heuristic
 * that would drift from what intake actually requires.
 */
export const CONTRACT_SECTIONS = [
  "scope",
  "non-goals",
  "audience",
  "compatibility",
  "security",
  "performance",
  "observability",
  "rollout",
  "acceptance",
] as const;

/**
 * The three artifacts an adversarial roast round covers (ledger Gap 19).
 *
 * Deliberately these three and not "the work": each is reviewable on its own
 * terms and at its own moment, and a roast of the test suite in particular is
 * not a gate verdict and never substitutes for one.
 */
export const ROAST_ARTIFACTS = ["the design", "the tests", "the implementation"] as const;

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

**Roast your own work three times: ${ROAST_ARTIFACTS.join(", ")}.** Each
round is adversarial and gets a fresh reviewer. A round counts only if it
yields a finding that is **novel** and **falsifiable** — a concrete failure
scenario, these inputs giving that wrong result. Taste does not count. **No
severity floor.** Keep going until a round finds nothing new; verify before
acting, since a confident reviewer is still sometimes wrong. A roast round is
**read-only**, spends none of \`exhausted_repairs\`' three attempts, and a
third round is therefore not a stop condition.

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
asks for detail — and format the long answer too. Signpost state with these
glyphs and no others; they are navigation aids, not decoration:

${renderGlyphVocabulary()}

Flat monochrome text is as hard to hold onto as unstructured text, so carry
contrast too. You cannot emit terminal colour here — weight is your channel:
**bold** the verdict and the numbers that matter, wrap every identifier, path
and command in \`code\`, and let the glyphs above carry the rest.

None of this reaches shared artifacts: PR, commit, Jira and Grafana text
stays neutral and emoji-free under the renderer's own policy.`;
}

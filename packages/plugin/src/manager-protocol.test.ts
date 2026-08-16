import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_POLICY,
  PRESENTATION_GLYPH_ROLES,
  REVIEW_RUNAWAY_GUARD,
  glyph,
} from "@crabgic/contracts";
import {
  CONTRACT_SECTIONS,
  FINDING_DISPOSITIONS,
  REVIEW_ARTIFACTS,
  REVIEW_VERDICTS,
  MANAGER_STOP_CONDITIONS,
  MANAGER_APPROVAL_GATES,
  PIPELINE_PLAN_TOOL_NAME,
  QUESTION_TOOL_NAME,
  STAGE_LOOP_WORKFLOW_NAME,
  buildManagerProtocolBlock,
  type ManagerStopCondition,
} from "./manager-protocol.js";

/**
 * The protocol is prose that ships into a consuming repo's `CLAUDE.md` and
 * changes how the manager session behaves. Prose cannot be unit-tested for
 * "does the model obey it", so these tests pin the things that CAN regress
 * silently: that every stop condition the supervisor can actually raise is
 * represented, that the two defects this protocol exists to fix are each
 * addressed by a specific clause, and that the graceful-degradation clause
 * demanded by docs/engine-baseline.md §18.2 is present.
 */
describe("manager stop conditions", () => {
  it("carries exactly the seven roadmap/11 stop conditions", () => {
    expect(MANAGER_STOP_CONDITIONS).toHaveLength(7);
  });

  it("uses the supervisor's own kind strings as ids, so a rename cannot silently desync", () => {
    expect(MANAGER_STOP_CONDITIONS.map((c) => c.kind)).toEqual([
      "material_amendment",
      "expanded_authority",
      "critical_security_issue",
      "unsafe_overlap",
      "irreducible_product_decision",
      "exhausted_repairs",
      "blocking_verification",
    ]);
  });

  it("gives every condition a human-facing label and a concrete trigger description", () => {
    for (const condition of MANAGER_STOP_CONDITIONS) {
      expect(condition.label.length, `${condition.kind} label`).toBeGreaterThan(0);
      expect(condition.whenItFires.length, `${condition.kind} whenItFires`).toBeGreaterThan(20);
      // The label is what a human reads in the terminal; it must not leak the snake_case id.
      expect(condition.label).not.toContain("_");
    }
  });

  it("names the irreducible product decision — the ONLY condition that is a question for the owner", () => {
    const productDecision = MANAGER_STOP_CONDITIONS.find(
      (c) => c.kind === "irreducible_product_decision",
    ) as ManagerStopCondition;
    expect(productDecision.asksTheHuman).toBe(true);
    // Every other condition halts the run; it does not open a multiple-choice question.
    const others = MANAGER_STOP_CONDITIONS.filter((c) => c.kind !== "irreducible_product_decision");
    expect(others.every((c) => c.asksTheHuman === false)).toBe(true);
  });
});

describe("approval gates", () => {
  it("lists the human-approval gates as distinct from stop conditions", () => {
    expect(MANAGER_APPROVAL_GATES.length).toBeGreaterThanOrEqual(2);
    for (const gate of MANAGER_APPROVAL_GATES) {
      expect(gate.trigger.length).toBeGreaterThan(0);
    }
  });

  it("includes the contract-approval gate and the capability-trust gate", () => {
    const triggers = MANAGER_APPROVAL_GATES.map((g) => g.trigger);
    expect(triggers).toContain("/eo:approve");
    expect(triggers.some((t) => t.includes("trust review"))).toBe(true);
  });

  /**
   * roadmap/25 work item 5 (owner ruling R2): the `design-gate` stage is a
   * FOURTH approval gate, and the whole point of it is that the model cannot
   * satisfy it. The enforcement landed — `resolveDesignGate` closes that stage
   * on a recorded owner verdict and on nothing else, and the gateway exposes no
   * tool that can write one — but the gate was never added to this roster,
   * which is the only place the manager session is TOLD it exists.
   *
   * A gate the manager does not know about is a gate it will never render and
   * never wait at; it will run the design stage into a wall it cannot name.
   * That is the same class of defect as the missing `/eo:pipeline` row in the
   * installer's block: enforcement built, surface unannounced.
   */
  it("includes the design gate — roadmap/25 WI 5, the fourth gate R2 granted", () => {
    const triggers = MANAGER_APPROVAL_GATES.map((g) => g.trigger);
    expect(triggers.some((t) => t.includes("design approve"))).toBe(true);
  });

  it("gives every gate a description of what is under review, never a bare command", () => {
    for (const gate of MANAGER_APPROVAL_GATES) {
      expect(gate.what.length, `empty description: ${gate.trigger}`).toBeGreaterThan(0);
    }
  });
});

describe("buildManagerProtocolBlock", () => {
  const block = buildManagerProtocolBlock();

  it("forbids the continue-prompt defect explicitly, in words a model can match on", () => {
    // Defect 1: the manager asked the owner to type "continue" after every step.
    expect(block).toMatch(/never ask/i);
    expect(block.toLowerCase()).toContain("continue");
    expect(block).toMatch(/autonom/i);
  });

  it("mandates the structured question tool by its exact engine name", () => {
    // Defect 2: the manager rendered choices as a plain-text "1/2/3/4" list.
    expect(block).toContain(QUESTION_TOOL_NAME);
    expect(QUESTION_TOOL_NAME).toBe("AskUserQuestion");
  });

  it("forbids the plain-text numbered-option fallback the owner reported", () => {
    expect(block).toMatch(/numbered|plain-text|1 \/ 2 \/ 3/i);
  });

  it("carries the graceful-degradation clause docs/engine-baseline.md §18.2 requires", () => {
    // §18.2 records the interactive presence of AskUserQuestion as UNRESOLVED,
    // so shipped behavior must not depend on the tool existing.
    expect(block).toMatch(/if .{0,40}(unavailable|not available)/i);
    expect(block).toMatch(/consolidated/i);
  });

  it("renders every stop condition's label into the block", () => {
    for (const condition of MANAGER_STOP_CONDITIONS) {
      expect(block, `missing stop condition: ${condition.kind}`).toContain(condition.label);
    }
  });

  it("renders every approval gate's trigger into the block", () => {
    for (const gate of MANAGER_APPROVAL_GATES) {
      expect(block, `missing gate: ${gate.trigger}`).toContain(gate.trigger);
    }
  });

  it("stays compact enough to sit in an always-loaded CLAUDE.md block", () => {
    // The placement decision was "compact always-loaded block + detailed skill".
    // A block that grows without bound defeats the point; the full rationale
    // belongs in skills/protocol/SKILL.md, which is loaded on demand.
    //
    // Raised 45 -> 55 when the reporting rules landed (see the reporting-format
    // suite below): the block now carries three mandated behaviors — autonomy,
    // structured questions, and report formatting — not two. The cap exists to
    // force new rationale into the on-demand skill, and it still does.
    //
    // Raised 55 -> 70 (2026-07-28) when the clarify loop and the roast loops
    // landed, taking it to five mandated behaviors. Raising a cap to pass a
    // test is a thing to be suspicious of, so the reasoning is recorded rather
    // than assumed: both additions are the PRODUCT — a session that does not
    // research before asking, or does not roast its own work, is not doing the
    // thing the owner asked for — and neither can be deferred to an on-demand
    // skill, because a session only loads that skill if it already knows to.
    // Everything explanatory about them (why novelty and falsifiability are
    // the termination rule, why a roast is not a repair attempt) stays in
    // skills/protocol/SKILL.md; what is here is only the instruction itself.
    //
    // Raised 70 -> 78 (2026-07-29) when the roast paragraph was replaced by the
    // staged review pipeline (ledger Gap 19 as amended). The replacement says
    // strictly more than what it replaced -- a verdict vocabulary, an exit-
    // criteria close, the blocking/advisory split with its disposition rule,
    // debt becoming blocking on touch, and a progress budget -- and every one
    // of those is an instruction the session must follow rather than rationale
    // it may look up. The first draft came in at 86 lines and was compressed to
    // 76 before this cap moved; the eight lines of headroom are for the wording
    // to breathe, not for new content.
    //
    // Everything explanatory still goes to the on-demand skill: WHY novelty and
    // falsifiability stopped being the termination rule, and what twelve
    // non-converging rounds measured, live in skills/protocol/SKILL.md.
    //
    // Raised 78 -> 81 (2026-08-11) for the four VOLUME rules — no preamble/
    // recap/closer, park tangents, carry progress across turns, end on one next
    // action. Same test as every prior raise: is this instruction or rationale?
    // It is instruction, and it is not reachable from the on-demand skill,
    // because a manager that opens with a paragraph of preamble has already
    // emitted it before any skill could be consulted.
    //
    // It is also a DIFFERENT rule class from the six limits above it, which is
    // why the existing lines did not already cover it: those bound a report's
    // SHAPE, and a report can satisfy every one of them while still restating
    // the request, answering an unasked question and closing with an offer of
    // further help. Shape rules cannot express "less of it".
    //
    // Three lines, drafted at eight and compressed. No headroom is being
    // banked here — the next addition compresses or goes to the skill.
    //
    // The cost is real and worth stating: ~81 lines is roughly 930 tokens on
    // every manager turn.
    //
    // Raised 81 -> 85 (2026-08-16) for the sequencing paragraph — roadmap/25
    // exit criterion 15. Same test as every prior raise, and it is the raise
    // with the strongest case: the criterion is LITERALLY that this block stop
    // describing a sequence it does not control, and the only way to stop
    // describing it while still being useful is to point at the surface that
    // does — `pipeline.plan` and `crabgic-stage-loop`.
    //
    // It cannot be deferred to skills/pipeline/SKILL.md, and this is not the
    // usual hand-wave: a session only opens that skill if it already knows the
    // pipeline surface exists, and not knowing it exists IS the defect. The
    // preceding raise's note said "the next addition compresses or goes to the
    // skill" — it compressed, from five lines to three plus its blank.
    const lines = block.split("\n");
    expect(lines.length).toBeLessThanOrEqual(85);
  });

  it("is deterministic — the installer's byte-preserving merge depends on it", () => {
    expect(buildManagerProtocolBlock()).toBe(block);
  });

  it("emits no trailing whitespace, so the merge never produces a whitespace-only diff", () => {
    for (const line of block.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });
});

/**
 * The reporting half of the protocol. Defect 3, reported by the owner: the
 * manager reported in long unstructured prose, which the owner has a
 * condition that makes very hard to read. Like the two defects above this is
 * model behavior, so it is addressed in prose and pinned here only for the
 * parts that CAN regress silently — that the rules are present, that the
 * numbers come from `PresentationPolicy` rather than being retyped, and that
 * the outbound-artifact carve-out survives.
 */
describe("buildManagerProtocolBlock — reporting format", () => {
  const block = buildManagerProtocolBlock();

  it("states the accessibility reason, so the rule is not read as a style preference", () => {
    expect(block).toMatch(/hard to read|hard to parse/i);
  });

  it("puts the answer first", () => {
    expect(block).toMatch(/answer first/i);
  });

  it("quotes every structural limit from PresentationPolicy rather than hardcoding a second copy", () => {
    const limits = DEFAULT_PRESENTATION_POLICY.limits;
    expect(block).toContain(`${limits.leadAnswerMaxLines} lines`);
    expect(block).toContain(`${limits.headingRequiredAboveLines} lines`);
    expect(block).toContain(`${limits.proseBlockMaxLines} unbroken`);
    expect(block).toContain(`${limits.bulletMaxWords} words`);
    expect(block).toContain(`${limits.sectionMaxBullets} per section`);
    expect(block).toContain(`${limits.tableMinRows}+ items`);
  });

  it("renders the whole emoji glyph vocabulary, each paired with its role name", () => {
    for (const role of PRESENTATION_GLYPH_ROLES) {
      expect(block, `missing glyph role: ${role}`).toContain(`${glyph(role, "emoji")} ${role}`);
    }
  });

  it("frames emoji as navigation aids rather than decoration", () => {
    expect(block).toMatch(/not decoration|never decoration/i);
  });

  /**
   * The limits above bound the SHAPE of a report; they say nothing about how
   * much of it should exist. A block that obeys every one of them can still
   * open with a paragraph restating the request, close with an offer to help
   * further, and carry two paragraphs about something the owner did not ask
   * about — all of it structurally legal and all of it reading the owner does
   * not need to do. These four rules bound the VOLUME, and they are the ones
   * `docs/presentation-policy.md`'s limit table cannot express.
   */
  it("forbids preamble, recap and closing pleasantries", () => {
    expect(block).toMatch(/no preamble/i);
    expect(block).toMatch(/recap/i);
  });

  it("requires the report to end on a single next action", () => {
    expect(block).toMatch(/next action/i);
  });

  it("tells the manager to park tangents rather than widen the report", () => {
    expect(block).toMatch(/tangent/i);
  });

  it("requires progress to be restated across turns, so a lost thread is recoverable", () => {
    // Deliberately matches the CONCRETE form, not the word "progress" — the
    // block already used that word twice for the autonomy rule ("Progress is
    // the default"), so a looser pattern here passed while the reporting rule
    // it was meant to pin did not exist at all.
    expect(block).toMatch(/step \d+ of \d+/i);
  });

  it("carves out the outbound artifacts, which stay neutral and emoji-free", () => {
    // packages/renderer's Jira ADF whitelist rejects the `emoji` node outright;
    // a manager that decorates a PR body would produce a policy_blocked render.
    expect(block).toMatch(/emoji-free|no emoji/i);
    expect(block.toLowerCase()).toMatch(/pr|commit|jira|grafana/);
  });

  it("keeps brevity the default without licensing a wall of prose when detail is asked for", () => {
    // `[\s\S]` rather than `.` — the clause legitimately spans a line break.
    expect(block).toMatch(/unless[\s\S]{0,60}ask/i);
  });

  it("names the session's colour channel — weight, not ANSI, which the manager cannot emit", () => {
    // The CLI paints its own stdout with SGR codes. The manager writes into a
    // markdown-rendering TUI, so its only weight controls are bold and code.
    expect(block).toMatch(/\*\*bold\*\*|bold/i);
    expect(block).toContain("`code`");
  });
});

/**
 * The two loops the owner's 2026-07-28 direction adds (ledger Gaps 18/19).
 * They are model behaviour, so they live in the protocol text — and like
 * everything else in it, they are written here exactly once and rendered
 * into the managed block and the long-form skill.
 */
describe("buildManagerProtocolBlock — the clarify loop", () => {
  const block = buildManagerProtocolBlock();

  it("tells the session to research BEFORE asking, not instead of asking", () => {
    expect(block).toMatch(/research/i);
    expect(block.toLowerCase()).toContain("before");
  });

  /**
   * The loop needs a checkable exit condition or it either runs forever or
   * stops early on a hunch. The IntentContract's own nine sections already
   * ARE that checklist, which is why the protocol names them rather than
   * inventing a heuristic.
   */
  it("terminates on the IntentContract's nine sections, not on a feeling", () => {
    for (const section of CONTRACT_SECTIONS) {
      expect(block).toContain(section);
    }
  });

  it("requires acceptance criteria to be testable before the loop may close", () => {
    expect(block).toMatch(/acceptance criteria/i);
    expect(block).toMatch(/testable/i);
  });
});

describe("buildManagerProtocolBlock — the staged review pipeline", () => {
  const block = buildManagerProtocolBlock();
  /**
   * The block is hard-wrapped so the installer's byte-preserving merge stays
   * deterministic, which means any multi-word phrase can be split across a line
   * break. Two assertions below were written against the unwrapped text and
   * failed for that reason alone -- the property held, the regex did not see it.
   * Phrase assertions therefore run against a whitespace-normalized copy; ones
   * that care about single tokens keep using `block` directly.
   */
  const flat = block.replace(/\s+/g, " ");

  it("names every artifact a review round covers", () => {
    for (const artifact of REVIEW_ARTIFACTS) {
      expect(block.toLowerCase()).toContain(artifact.toLowerCase());
    }
  });

  /**
   * The single change that makes the loop able to terminate at all. The
   * superseded charter told the reviewer "do not approve it", which left it
   * with no vocabulary for done -- measured over twelve rounds that never
   * converged (docs/staged-review-pipeline.md §2).
   */
  it("makes `approve` a reachable verdict, not just `revise`", () => {
    for (const verdict of REVIEW_VERDICTS) {
      expect(block).toContain(verdict);
    }
    expect(block).toMatch(/approve/i);
  });

  it("blocks only on a finding that names the exit criterion it violates", () => {
    expect(block).toMatch(/blocking/i);
    expect(block).toMatch(/exit criteri/i);
  });

  /**
   * The owner's constraint on the severity floor: it gates the LOOP, never the
   * LEDGER. A stage may not advance holding an undispositioned finding at any
   * severity, so "advisory" can never become a disposal route.
   */
  it("requires every finding to carry a disposition, whatever its severity", () => {
    for (const disposition of FINDING_DISPOSITIONS) {
      expect(block).toContain(disposition);
    }
    expect(flat).toMatch(/never advance|cannot advance|may not advance/i);
  });

  it("states the zero-findings exit and the runaway guard", () => {
    // AMENDED by owner ruling R4 (2026-08-15). The superseded assertion looked
    // for the progress rule -- "loops while each round closes at least one
    // blocking finding" -- which is no longer what ends a loop. A stage closes
    // on a round raising no admissible novel finding, and the old ceiling
    // survives only as the runaway guard.
    expect(flat).toContain(String(REVIEW_RUNAWAY_GUARD));
    expect(flat).toMatch(/no admissible novel\s+finding/i);
    expect(flat).toMatch(/runaway guard/i);
    // Severity must be stated as irrelevant to closure, or a reader reconstructs
    // the severity floor the owner ruled against.
    expect(flat).toMatch(/severity plays no part/i);
  });

  it("makes deferred debt blocking when its code is next touched", () => {
    expect(block).toMatch(/accepted-debt/);
    expect(block).toMatch(/touch/i);
  });

  /**
   * The tool-grounded half takes precedence over the judged half: anything a
   * deterministic gate decides is not a reviewer's to re-litigate in prose.
   */
  it("forbids a reviewer re-deciding what a gate already decides", () => {
    expect(block).toMatch(/gate/i);
  });

  it("keeps novelty and falsifiability as admissibility tests", () => {
    expect(block).toMatch(/novel/i);
    expect(block).toMatch(/falsifiable|failure scenario/i);
  });

  it("requires a fresh reviewer per round", () => {
    expect(block).toMatch(/fresh/i);
  });

  it("separates a review round from a repair attempt explicitly", () => {
    expect(block).toMatch(/exhausted_repairs|repair attempt/i);
    expect(block).toMatch(/read-only|reads only/i);
  });

  /**
   * Regression guard against the superseded ruling. Ledger Gap 19 part 4 was
   * amended 2026-07-29 precisely because "no severity floor" plus "keep going
   * until a round finds nothing" does not terminate; if either phrase comes
   * back, the block contradicts the ledger that governs it.
   */
  it("no longer carries the superseded unbounded-loop language", () => {
    expect(block).not.toMatch(/no severity floor/i);
    expect(block).not.toMatch(/until a round finds nothing/i);
  });
});

/**
 * roadmap/25 exit criterion 15 — "`buildManagerProtocolBlock()` no longer
 * describes a sequence it does not control".
 *
 * The block states the review loop's RULES, and those it does own: they are
 * model behavior and prose is the only delivery path for them. What it must not
 * do is leave a reader with the impression that stage ORDER, lens COVERAGE and
 * round BUDGET are also its to interpret. They are not — they are decided
 * server-side by `pipeline.plan`, and driven by `crabgic-stage-loop`. That was
 * the whole complaint phase 25 was written against: sequencing that existed
 * only as prose a model may skip.
 *
 * So the block must POINT AT the surface that owns them. A manager session that
 * is never told `pipeline.plan` exists will reconstruct a stage order from the
 * rules it can see, which is exactly the failure mode, arrived at by a reader
 * being reasonable rather than by one being careless.
 */
describe("buildManagerProtocolBlock — sequencing it does not own", () => {
  const block = buildManagerProtocolBlock();
  const flat = block.replace(/\s+/g, " ");

  it("names the tool that decides what runs next", () => {
    expect(block).toContain(PIPELINE_PLAN_TOOL_NAME);
    expect(PIPELINE_PLAN_TOOL_NAME).toBe("pipeline.plan");
  });

  it("names the driver that runs the rounds", () => {
    expect(block).toContain(STAGE_LOOP_WORKFLOW_NAME);
    expect(STAGE_LOOP_WORKFLOW_NAME).toBe("crabgic-stage-loop");
  });

  /**
   * The load-bearing half. Naming the tool is not enough: a block that names
   * `pipeline.plan` while still reading as "here is the sequence, follow it"
   * has added a citation to the defect rather than fixing it. The block has to
   * say the decision is not the session's.
   */
  it("states that stage order and lens coverage are the server's, not the session's", () => {
    expect(flat).toMatch(/ask .{0,60}what (stage |)(comes next|runs next)|do not decide/i);
    expect(flat).toMatch(/never (decide|choose|invent)|not yours|the server(')?s/i);
  });

  it("keeps the block deterministic once the pipeline surface is named", () => {
    expect(buildManagerProtocolBlock()).toBe(block);
  });
});

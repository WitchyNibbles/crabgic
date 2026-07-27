import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_POLICY, PRESENTATION_GLYPH_ROLES, glyph } from "@crabgic/contracts";
import {
  MANAGER_STOP_CONDITIONS,
  MANAGER_APPROVAL_GATES,
  QUESTION_TOOL_NAME,
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
    const lines = block.split("\n");
    expect(lines.length).toBeLessThanOrEqual(55);
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

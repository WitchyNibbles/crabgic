import { describe, expect, it } from "vitest";
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
    const lines = block.split("\n");
    expect(lines.length).toBeLessThanOrEqual(45);
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

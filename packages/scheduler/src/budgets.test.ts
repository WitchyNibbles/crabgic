import { describe, expect, it } from "vitest";
import { buildTaskPacket } from "@eo/testkit";
import {
  checkPacketBudgets,
  assertPacketWithinBudget,
  DEFAULT_PACKET_FIELD_BUDGETS,
  renderBudgetedField,
} from "./budgets.js";
import { PacketBudgetExceededError } from "./errors.js";

describe("checkPacketBudgets", () => {
  it("returns no violations for a fixture packet within every default budget", () => {
    const packet = buildTaskPacket();
    expect(checkPacketBudgets(packet)).toEqual([]);
  });

  it("flags an over-budget objective with an actionable diff and never mutates the packet", () => {
    const overLong = "x".repeat(DEFAULT_PACKET_FIELD_BUDGETS.objective + 50);
    const packet = buildTaskPacket({ objective: overLong });

    const violations = checkPacketBudgets(packet);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      field: "objective",
      limitBytes: DEFAULT_PACKET_FIELD_BUDGETS.objective,
      actualBytes: overLong.length,
      overageBytes: 50,
    });
    // Actionable diff: the exact excess tail, never a silently truncated field.
    expect(violations[0]?.diff).toBe("x".repeat(50));
    // The packet itself is untouched — no truncation happened.
    expect(packet.objective).toBe(overLong);
  });

  it("flags every over-budget field independently, in field order", () => {
    const packet = buildTaskPacket({
      objective: "x".repeat(DEFAULT_PACKET_FIELD_BUDGETS.objective + 1),
      gates: ["g".repeat(DEFAULT_PACKET_FIELD_BUDGETS.gates + 1)],
    });

    const violations = checkPacketBudgets(packet);
    expect(violations.map((v) => v.field)).toEqual(["objective", "gates"]);
  });

  it("measures array fields as their newline-joined rendering", () => {
    const packet = buildTaskPacket({ nonGoals: ["a", "b", "c"] });
    expect(renderBudgetedField(packet, "nonGoals")).toBe("a\nb\nc");
  });

  it("measures resultSchema via JSON.stringify", () => {
    const packet = buildTaskPacket({ resultSchema: { type: "object", properties: {} } });
    expect(renderBudgetedField(packet, "resultSchema")).toBe(
      JSON.stringify({ type: "object", properties: {} }),
    );
  });

  it("MINOR-5 regression: measures TRUE UTF-8 byte length, not JS string .length — a field within char-count but over BYTE budget is still flagged", () => {
    // "é" (U+00E9) is 1 UTF-16 code unit / 1 JS `.length` unit, but 2 bytes in
    // UTF-8. 1500 of them is well under the 2000-char objective budget by
    // `.length`, but 3000 UTF-8 bytes — genuinely OVER the 2000-BYTE budget.
    // A `.length`-based (char-counting) implementation would wrongly report
    // zero violations here.
    const multiByteChar = "é";
    const charCount = 1500;
    expect(charCount).toBeLessThan(DEFAULT_PACKET_FIELD_BUDGETS.objective);
    const objective = multiByteChar.repeat(charCount);
    const trueByteLength = Buffer.byteLength(objective, "utf8");
    expect(trueByteLength).toBe(charCount * 2);
    expect(trueByteLength).toBeGreaterThan(DEFAULT_PACKET_FIELD_BUDGETS.objective);

    const packet = buildTaskPacket({ objective });
    const violations = checkPacketBudgets(packet);

    const objectiveViolation = violations.find((v) => v.field === "objective");
    expect(objectiveViolation).toBeDefined();
    expect(objectiveViolation?.actualBytes).toBe(trueByteLength);
    expect(objectiveViolation?.overageBytes).toBe(
      trueByteLength - DEFAULT_PACKET_FIELD_BUDGETS.objective,
    );
  });

  it("respects caller-supplied narrower budgets", () => {
    const packet = buildTaskPacket({ objective: "short but not THAT short" });
    const violations = checkPacketBudgets(packet, {
      ...DEFAULT_PACKET_FIELD_BUDGETS,
      objective: 5,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("objective");
  });
});

describe("assertPacketWithinBudget", () => {
  it("does not throw for a within-budget packet", () => {
    expect(() => assertPacketWithinBudget(buildTaskPacket())).not.toThrow();
  });

  it("throws PacketBudgetExceededError — blocking dispatch, never silently truncating — for an over-budget packet", () => {
    const packet = buildTaskPacket({
      objective: "x".repeat(DEFAULT_PACKET_FIELD_BUDGETS.objective + 1),
    });
    expect(() => assertPacketWithinBudget(packet)).toThrow(PacketBudgetExceededError);
    try {
      assertPacketWithinBudget(packet);
      expect.unreachable("assertPacketWithinBudget must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PacketBudgetExceededError);
      const typed = err as PacketBudgetExceededError;
      expect(typed.violations).toHaveLength(1);
      expect(typed.message).toContain("objective");
    }
  });
});

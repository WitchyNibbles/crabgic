import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildTaskPacket } from "@eo/testkit";
import { checkPacketBudgets, DEFAULT_PACKET_FIELD_BUDGETS } from "./budgets.js";

/**
 * Property test — roadmap/13 §Test plan, Property (fast-check): "random
 * packet field mutations — any field exceeding budget blocks dispatch."
 * Exit criterion: "Packet budget violations block dispatch with an
 * actionable diff — no silent truncation (unit suite)" — this property
 * suite is the fast-check half backing that same guarantee.
 *
 * Character pool deliberately excludes whitespace: `@eo/contracts`'
 * `NonEmptyStringSchema` is `z.string().trim().min(1)` — zod's `.trim()`
 * TRANSFORMS the parsed value, so a generated string with leading/trailing
 * whitespace would silently shrink between "what this test generated" and
 * "what `buildTaskPacket` actually stored," breaking this suite's own
 * length arithmetic. A non-whitespace charset sidesteps that entirely.
 */
const NON_WHITESPACE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.".split("");

function nonWhitespaceString(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...NON_WHITESPACE_CHARS), { minLength, maxLength })
    .map((chars) => chars.join(""));
}

describe("checkPacketBudgets — property: any field mutation exceeding its budget is always flagged", () => {
  it("an objective longer than its budget is ALWAYS flagged, regardless of content", () => {
    fc.assert(
      fc.property(
        nonWhitespaceString(DEFAULT_PACKET_FIELD_BUDGETS.objective + 1, 3_000),
        (overLongObjective) => {
          const packet = buildTaskPacket({ objective: overLongObjective });
          const violations = checkPacketBudgets(packet);
          const objectiveViolation = violations.find((v) => v.field === "objective");
          expect(objectiveViolation).toBeDefined();
          expect(objectiveViolation?.actualBytes).toBe(overLongObjective.length);
          expect(objectiveViolation?.overageBytes).toBe(
            overLongObjective.length - DEFAULT_PACKET_FIELD_BUDGETS.objective,
          );
          // Never silently truncated — the packet's own field is untouched.
          expect(packet.objective).toBe(overLongObjective);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("an objective within its budget is NEVER flagged, regardless of content", () => {
    fc.assert(
      fc.property(
        nonWhitespaceString(1, DEFAULT_PACKET_FIELD_BUDGETS.objective),
        (withinBudgetObjective) => {
          const packet = buildTaskPacket({ objective: withinBudgetObjective });
          const violations = checkPacketBudgets(packet);
          expect(violations.find((v) => v.field === "objective")).toBeUndefined();
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("gates array total length exceeding budget is always flagged", () => {
    fc.assert(
      fc.property(
        fc.array(nonWhitespaceString(1, 50), { minLength: 1, maxLength: 40 }),
        (gates) => {
          const packet = buildTaskPacket({ gates });
          const rendered = gates.join("\n");
          const violations = checkPacketBudgets(packet);
          const gatesViolation = violations.find((v) => v.field === "gates");
          if (rendered.length > DEFAULT_PACKET_FIELD_BUDGETS.gates) {
            expect(gatesViolation).toBeDefined();
          } else {
            expect(gatesViolation).toBeUndefined();
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

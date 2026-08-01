import { describe, expect, it } from "vitest";
import {
  ECOSYSTEM_RESEARCH_BUDGETS,
  KNOWN_RESEARCH_ECOSYSTEMS,
  ecosystemResearchBudgets,
  isKnownResearchEcosystem,
} from "./ecosystem-research-table.js";

/**
 * The table is indexed by a caller-supplied string that reaches this module
 * straight from `JSON.parse` (intake reads its request off stdin with no
 * `IntakeRequestSchema`). A plain object literal inherits `Object.prototype`,
 * so `TABLE[ecosystem]` answers for members nobody put in the table:
 * `"constructor"` yields `Object` (arity 1), `"hasOwnProperty"` a function of
 * arity 1 — both pass a `.length > 0` liveness check, and the caller then
 * spreads a function. That crashed `runIntake` with
 * `TypeError: researched is not iterable` from inside `@crabgic/contracts`.
 */
describe("ecosystemResearchBudgets", () => {
  it("answers only for own table rows", () => {
    for (const ecosystem of KNOWN_RESEARCH_ECOSYSTEMS) {
      const budgets = ecosystemResearchBudgets(ecosystem);
      expect(budgets).toBeDefined();
      expect(budgets!.length).toBeGreaterThan(0);
    }
  });

  it.each(["constructor", "hasOwnProperty", "__proto__", "toString", "valueOf", "isPrototypeOf"])(
    "returns undefined for inherited Object.prototype member %j instead of leaking it",
    (member) => {
      expect(ecosystemResearchBudgets(member)).toBeUndefined();
    },
  );

  it("returns undefined for an unknown-but-harmless ecosystem", () => {
    expect(ecosystemResearchBudgets("java")).toBeUndefined();
    expect(ecosystemResearchBudgets("")).toBeUndefined();
  });

  it("KNOWN_RESEARCH_ECOSYSTEMS is exactly the table's own keys, sorted", () => {
    expect([...KNOWN_RESEARCH_ECOSYSTEMS]).toEqual(
      Object.keys(ECOSYSTEM_RESEARCH_BUDGETS).sort((a, b) => a.localeCompare(b)),
    );
  });

  it("isKnownResearchEcosystem accepts own rows and rejects inherited members", () => {
    expect(isKnownResearchEcosystem("node")).toBe(true);
    expect(isKnownResearchEcosystem("constructor")).toBe(false);
    expect(isKnownResearchEcosystem("hasOwnProperty")).toBe(false);
    expect(isKnownResearchEcosystem("java")).toBe(false);
  });
});

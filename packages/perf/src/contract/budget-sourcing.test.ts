import { describe, expect, it } from "vitest";
import { resolveBudgetSource } from "./budget-sourcing.js";

describe("resolveBudgetSource", () => {
  it("source #1 wins when Requirement acceptance criteria parse to at least one budget", () => {
    const result = resolveBudgetSource({
      requirementAcceptanceCriteria: ["latency p95 <= 200ms"],
      ecosystem: "node",
    });
    expect(result.source).toBe("requirement_acceptance_criteria");
    expect(result.budgets).toEqual([
      { metric: "latency", percentile: 95, threshold: 200, unit: "ms" },
    ]);
  });

  it("falls through to source #2 when acceptance criteria are pure prose", () => {
    const result = resolveBudgetSource({
      requirementAcceptanceCriteria: ["This should feel fast to users."],
      ecosystem: "node",
    });
    expect(result.source).toBe("ecosystem_research");
    expect(result.budgets.length).toBeGreaterThan(0);
  });

  it("falls through to source #2 when no Requirement acceptance criteria exist at all", () => {
    const result = resolveBudgetSource({ ecosystem: "go" });
    expect(result.source).toBe("ecosystem_research");
  });

  it("falls through to source #3 (empty, base-revision-measurement) when nothing resolves", () => {
    const result = resolveBudgetSource({});
    expect(result.source).toBe("base_revision_measurement");
    expect(result.budgets).toEqual([]);
  });

  it("falls through to source #3 when the ecosystem has no pinned research table entry", () => {
    const result = resolveBudgetSource({ ecosystem: "cobol" });
    expect(result.source).toBe("base_revision_measurement");
    expect(result.budgets).toEqual([]);
  });

  // The ecosystem label reaches this rule straight from `JSON.parse` (intake
  // has no `IntakeRequestSchema`). Before the `Object.hasOwn` guard,
  // `ECOSYSTEM_RESEARCH_BUDGETS["constructor"]` answered with `Object` — arity
  // 1, so it passed the `.length > 0` liveness check — and spreading it threw
  // `TypeError: researched is not iterable` out of `@crabgic/contracts`,
  // crashing `runIntake` on a one-word request body.
  it.each(["constructor", "hasOwnProperty", "__proto__", "toString", "isPrototypeOf"])(
    "falls through to source #3 for inherited Object.prototype member %j, never throwing",
    (member) => {
      const result = resolveBudgetSource({ ecosystem: member });
      expect(result.source).toBe("base_revision_measurement");
      expect(result.budgets).toEqual([]);
    },
  );

  it("source order is strict: a resolving source #1 wins even when source #2 would also resolve", () => {
    const result = resolveBudgetSource({
      requirementAcceptanceCriteria: ["cpu_time <= 1s"],
      ecosystem: "rust",
    });
    expect(result.source).toBe("requirement_acceptance_criteria");
    expect(result.budgets).toEqual([{ metric: "cpu_time", threshold: 1, unit: "s" }]);
  });
});

import { describe, expect, it } from "vitest";
import { ProvisionalPerformanceContractSchema } from "@eo/contracts";
import {
  buildProvisionalPerformanceContract,
  hashProvisionalBudgets,
} from "./performance-contract-builder.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

describe("buildProvisionalPerformanceContract", () => {
  it("builds a schema-valid provisional contract with a stable budgetHash", () => {
    const budgets = [{ metric: "latency" as const, percentile: 95, threshold: 200, unit: "ms" }];
    const contract = buildProvisionalPerformanceContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      budgetSource: "requirement_acceptance_criteria",
      budgets,
    });
    expect(ProvisionalPerformanceContractSchema.safeParse(contract).success).toBe(true);
    expect(contract.budgetHash).toBe(hashProvisionalBudgets(budgets));
  });

  it("an empty budget set is valid (no perf-sensitive requirements yet)", () => {
    const contract = buildProvisionalPerformanceContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      budgetSource: "ecosystem_research",
      budgets: [],
    });
    expect(contract.budgets).toEqual([]);
  });

  it("changing a budget's threshold changes budgetHash", () => {
    const a = hashProvisionalBudgets([{ metric: "cpu_time", threshold: 10, unit: "s" }]);
    const b = hashProvisionalBudgets([{ metric: "cpu_time", threshold: 20, unit: "s" }]);
    expect(a).not.toBe(b);
  });
});

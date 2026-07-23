import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  enforceBudgets,
  enforceItemBudget,
  enforceResultBudget,
  ITEM_BUDGET_BYTES,
  RESULT_BUDGET_BYTES,
} from "./budgets.js";

describe("enforceItemBudget", () => {
  it("allows a small item", () => {
    expect(() => enforceItemBudget("small")).not.toThrow();
  });

  it("allows an item exactly at the budget", () => {
    expect(() => enforceItemBudget("a".repeat(ITEM_BUDGET_BYTES))).not.toThrow();
  });

  it("throws BudgetExceededError for an item one byte over budget", () => {
    expect(() => enforceItemBudget("a".repeat(ITEM_BUDGET_BYTES + 1))).toThrow(BudgetExceededError);
  });

  it("measures actual UTF-8 byte length, not JS string length", () => {
    // Each "é" (U+00E9) is 2 bytes in UTF-8 but 1 UTF-16 code unit.
    const text = "é".repeat(ITEM_BUDGET_BYTES); // 2x bytes vs. .length
    expect(() => enforceItemBudget(text)).toThrow(BudgetExceededError);
  });
});

describe("enforceResultBudget", () => {
  it("allows a small result", () => {
    expect(() => enforceResultBudget("[]")).not.toThrow();
  });

  it("throws BudgetExceededError for a result over budget", () => {
    expect(() => enforceResultBudget("a".repeat(RESULT_BUDGET_BYTES + 1))).toThrow(
      BudgetExceededError,
    );
  });
});

describe("enforceBudgets", () => {
  it("passes for small items well under both budgets", () => {
    expect(() => enforceBudgets(["a", "b", "c"], (s) => s)).not.toThrow();
  });

  it("throws when a single item exceeds the item budget", () => {
    const items = ["small", "x".repeat(ITEM_BUDGET_BYTES + 1)];
    expect(() => enforceBudgets(items, (s) => s)).toThrow(BudgetExceededError);
  });

  it("throws when the aggregate exceeds the result budget even if every item is individually small", () => {
    const bigItem = "x".repeat(ITEM_BUDGET_BYTES / 2);
    const items = Array.from({ length: 20 }, () => bigItem); // ~160 KiB of item text + JSON overhead
    expect(() => enforceBudgets(items, (s) => s)).toThrow(BudgetExceededError);
  });

  it("error carries scope, actualBytes, and budgetBytes fields", () => {
    try {
      enforceItemBudget("x".repeat(ITEM_BUDGET_BYTES + 10));
      throw new Error("expected enforceItemBudget to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const budgetErr = err as BudgetExceededError;
      expect(budgetErr.scope).toBe("item");
      expect(budgetErr.budgetBytes).toBe(ITEM_BUDGET_BYTES);
      expect(budgetErr.actualBytes).toBe(ITEM_BUDGET_BYTES + 10);
    }
  });
});

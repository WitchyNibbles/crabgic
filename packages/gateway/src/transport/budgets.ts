/**
 * Result/item size budgets — roadmap/16-gateway-core.md §In scope,
 * "Budgets": "32 KiB item / 256 KiB result enforced here (typed truncation
 * errors) — deliberately independent of the unconfirmed engine-side
 * `MAX_MCP_OUTPUT_TOKENS`." Work item 4.
 *
 * Byte-size measured via `Buffer.byteLength(text, "utf8")` — the actual
 * wire size, not `string.length` (which undercounts multi-byte UTF-8).
 */

export const ITEM_BUDGET_BYTES = 32 * 1024;
export const RESULT_BUDGET_BYTES = 256 * 1024;

export class BudgetExceededError extends Error {
  readonly scope: "item" | "result";
  readonly actualBytes: number;
  readonly budgetBytes: number;

  constructor(scope: "item" | "result", actualBytes: number, budgetBytes: number) {
    super(`gateway budget exceeded (${scope}): ${actualBytes} bytes > ${budgetBytes}-byte budget`);
    this.name = "BudgetExceededError";
    this.scope = scope;
    this.actualBytes = actualBytes;
    this.budgetBytes = budgetBytes;
    Object.freeze(this);
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Throws `BudgetExceededError` if `text` (one item's serialized form) exceeds the 32 KiB item budget. */
export function enforceItemBudget(text: string): void {
  const actual = byteLength(text);
  if (actual > ITEM_BUDGET_BYTES) {
    throw new BudgetExceededError("item", actual, ITEM_BUDGET_BYTES);
  }
}

/** Throws `BudgetExceededError` if `text` (a full result payload) exceeds the 256 KiB result budget. */
export function enforceResultBudget(text: string): void {
  const actual = byteLength(text);
  if (actual > RESULT_BUDGET_BYTES) {
    throw new BudgetExceededError("result", actual, RESULT_BUDGET_BYTES);
  }
}

/**
 * Validates every item in `items` (via `serialize`) against the item
 * budget, then the JSON-serialized whole against the result budget.
 * Never silently drops items — a violation always throws rather than
 * truncating the array away from under the caller.
 */
export function enforceBudgets<T>(items: readonly T[], serialize: (item: T) => string): void {
  for (const item of items) {
    enforceItemBudget(serialize(item));
  }
  enforceResultBudget(JSON.stringify(items));
}

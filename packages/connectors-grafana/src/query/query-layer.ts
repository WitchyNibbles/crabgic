import { ITEM_BUDGET_BYTES, enforceItemBudget, enforceResultBudget } from "@eo/gateway";
import { redactSecretBearingObject } from "../security/redaction.js";

/**
 * Query layer — roadmap/20-grafana-adapters.md §In scope, "Reads/queries":
 * "approved dashboards/metrics/logs/traces/alerts only; required
 * time-range + field scoping; aggregation/redaction happens before results
 * enter worker context; size budgets enforced by 16 (32 KiB item / 256 KiB
 * result)." Work item 5.
 *
 * This module is the CONNECTOR-SIDE half of that requirement: it never
 * issues the query HTTP call itself (that stays inside `../adapter.js`'s
 * `send`-based dispatch, unchanged); it processes an already-fetched raw
 * result set — scoping fields, redacting secret-shaped values, and
 * downsampling/truncating until the SAME budgets `@eo/gateway`'s transport
 * enforces are satisfied BEFORE this package ever hands a result back to
 * its caller (so a caller never depends on the gateway's own enforcement
 * as backstop-of-first-resort).
 */

export interface GrafanaQueryTimeRange {
  readonly from: string;
  readonly to: string;
}

export class GrafanaQueryValidationError extends Error {
  constructor(message: string) {
    super(`Grafana query validation failed: ${message}`);
    this.name = "GrafanaQueryValidationError";
    Object.freeze(this);
  }
}

/** Requires an explicit, non-empty time range — roadmap/20: "required time-range... scoping." Never defaults to "all time." */
export function validateQueryTimeRange(
  timeRange: GrafanaQueryTimeRange | undefined,
): GrafanaQueryTimeRange {
  if (timeRange === undefined) {
    throw new GrafanaQueryValidationError(
      "a time range (from/to) is required — queries never default to unbounded time",
    );
  }
  if (timeRange.from.trim().length === 0 || timeRange.to.trim().length === 0) {
    throw new GrafanaQueryValidationError("time range from/to must both be non-empty");
  }
  return timeRange;
}

export type GrafanaQueryRow = Readonly<Record<string, unknown>>;

/**
 * Field-scoping + redaction for one row — roadmap/20: "field scoping...
 * aggregation/redaction." When `fields` is provided, only those TOP-LEVEL
 * keys survive; every surviving value is then redacted RECURSIVELY via
 * `../security/redaction.js`'s shared `redactSecretBearingObject` — a
 * secret-shaped key nested inside a non-secret-named parent (e.g. a log
 * row's `metadata.headers.authorization`) is redacted just as reliably as
 * a top-level one (adversarial-review LOW fix: the original version only
 * ever inspected top-level key names, missing exactly that nested case).
 */
export function scopeAndRedactRow(
  row: GrafanaQueryRow,
  fields?: readonly string[],
): GrafanaQueryRow {
  const allowedKeys = fields !== undefined ? new Set(fields) : undefined;
  const scoped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (allowedKeys !== undefined && !allowedKeys.has(key)) continue;
    scoped[key] = value;
  }
  return redactSecretBearingObject(scoped) as GrafanaQueryRow;
}

/** Truncates a single row's largest string field(s) until it fits the 32 KiB item budget — never silently drops the row; a row that cannot be shrunk under budget throws (fails closed) rather than passing through oversized. */
export function truncateRowToItemBudget(row: GrafanaQueryRow): GrafanaQueryRow {
  let candidate: Record<string, unknown> = { ...row };
  for (let guard = 0; guard < 64; guard += 1) {
    try {
      enforceItemBudget(JSON.stringify(candidate));
      return candidate;
    } catch {
      let largestKey: string | undefined;
      let largestLength = -1;
      for (const [key, value] of Object.entries(candidate)) {
        if (typeof value === "string" && value.length > largestLength) {
          largestKey = key;
          largestLength = value.length;
        }
      }
      if (largestKey === undefined || largestLength <= 64) {
        throw new Error(
          `Grafana query row exceeds the ${ITEM_BUDGET_BYTES}-byte item budget and cannot be shrunk further`,
        );
      }
      const truncated = `${(candidate[largestKey] as string).slice(0, Math.floor(largestLength / 2))}…(truncated)`;
      candidate = { ...candidate, [largestKey]: truncated };
    }
  }
  throw new Error("Grafana query row truncation did not converge under the item budget");
}

/** Downsamples `rows` (evenly, preserving first/last) until the JSON-serialized whole fits the 256 KiB result budget. */
export function downsampleToResultBudget(
  rows: readonly GrafanaQueryRow[],
): readonly GrafanaQueryRow[] {
  let candidate = rows;
  while (candidate.length > 1) {
    try {
      enforceResultBudget(JSON.stringify(candidate));
      return candidate;
    } catch {
      const keepEvery = Math.max(
        2,
        Math.ceil(candidate.length / Math.max(1, candidate.length - 1)),
      );
      const next = candidate.filter(
        (_, index) => index % keepEvery === 0 || index === candidate.length - 1,
      );
      if (next.length >= candidate.length) {
        // Guard against a non-converging filter (shouldn't happen given
        // keepEvery >= 2, but never loop forever regardless). Adversarial-
        // review LOW fix: this early return previously skipped the final
        // `enforceResultBudget` check entirely — benign in practice (a
        // single already-item-budget-checked row is always well under the
        // larger result budget), but asserted explicitly now rather than
        // silently assumed.
        const shrunk = candidate.slice(0, Math.max(1, Math.floor(candidate.length / 2)));
        enforceResultBudget(JSON.stringify(shrunk));
        return shrunk;
      }
      candidate = next;
    }
  }
  enforceResultBudget(JSON.stringify(candidate)); // a single row must itself already satisfy the budget (guaranteed by truncateRowToItemBudget upstream, since ITEM_BUDGET_BYTES < RESULT_BUDGET_BYTES)
  return candidate;
}

export interface ProcessGrafanaQueryResultInput {
  readonly timeRange: GrafanaQueryTimeRange | undefined;
  readonly fields?: readonly string[];
  readonly rawRows: readonly GrafanaQueryRow[];
}

/**
 * The full query-layer pipeline: validate time range → scope/redact each
 * row → truncate any still-oversized row → downsample the whole result set
 * — so by the time this function returns, BOTH budgets are already
 * satisfied, before the result ever leaves `packages/connectors-grafana`
 * (roadmap/20 exit criterion).
 */
export function processGrafanaQueryResult(
  input: ProcessGrafanaQueryResultInput,
): readonly GrafanaQueryRow[] {
  validateQueryTimeRange(input.timeRange);
  const scoped = input.rawRows.map((row) => scopeAndRedactRow(row, input.fields));
  const withinItemBudget = scoped.map(truncateRowToItemBudget);
  return downsampleToResultBudget(withinItemBudget);
}

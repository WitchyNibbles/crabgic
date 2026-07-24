import { describe, expect, it } from "vitest";
import { ITEM_BUDGET_BYTES, RESULT_BUDGET_BYTES } from "@eo/gateway";
import {
  GrafanaQueryValidationError,
  downsampleToResultBudget,
  processGrafanaQueryResult,
  scopeAndRedactRow,
  truncateRowToItemBudget,
  validateQueryTimeRange,
} from "./query-layer.js";

describe("validateQueryTimeRange — required time-range scoping", () => {
  it("rejects an absent time range", () => {
    expect(() => validateQueryTimeRange(undefined)).toThrow(GrafanaQueryValidationError);
  });

  it("rejects an empty from/to", () => {
    expect(() => validateQueryTimeRange({ from: "", to: "now" })).toThrow(
      GrafanaQueryValidationError,
    );
  });

  it("accepts a well-formed range", () => {
    expect(validateQueryTimeRange({ from: "now-1h", to: "now" })).toEqual({
      from: "now-1h",
      to: "now",
    });
  });
});

describe("scopeAndRedactRow — field scoping + secret redaction", () => {
  it("keeps only allowlisted fields when fields is provided", () => {
    const row = { service: "checkout", latencyMs: 120, region: "us-east-1" };
    expect(scopeAndRedactRow(row, ["service", "latencyMs"])).toEqual({
      service: "checkout",
      latencyMs: 120,
    });
  });

  it("keeps every field when no allowlist is given", () => {
    const row = { service: "checkout", latencyMs: 120 };
    expect(scopeAndRedactRow(row)).toEqual(row);
  });

  it("redacts a secret-shaped field even when explicitly allowlisted by the caller", () => {
    const row = { service: "checkout", apiToken: "sk-live-abcdef123456" };
    const scoped = scopeAndRedactRow(row, ["service", "apiToken"]);
    expect(scoped.apiToken).toBe("[redacted]");
    expect(scoped.service).toBe("checkout");
  });

  it("redacts common secret-shaped key spellings", () => {
    const row = { password: "p", secret: "s", Authorization: "Bearer x", api_key: "k" };
    const scoped = scopeAndRedactRow(row);
    expect(Object.values(scoped).every((v) => v === "[redacted]")).toBe(true);
  });

  it("adversarial-review LOW fix: redacts a secret-shaped key NESTED under a non-secret-named parent, not just top-level keys", () => {
    const row = {
      service: "checkout",
      metadata: { headers: { authorization: "Bearer sk-live-abcdef", "x-request-id": "req-1" } },
    };
    const scoped = scopeAndRedactRow(row) as {
      metadata: { headers: { authorization: string; "x-request-id": string } };
    };
    expect(scoped.metadata.headers.authorization).toBe("[redacted]");
    expect(scoped.metadata.headers["x-request-id"]).toBe("req-1");
  });

  it("recurses into arrays of objects when redacting", () => {
    const row = { entries: [{ password: "p1" }, { password: "p2" }] };
    const scoped = scopeAndRedactRow(row) as { entries: readonly { password: string }[] };
    expect(scoped.entries.every((e) => e.password === "[redacted]")).toBe(true);
  });
});

describe("truncateRowToItemBudget — exit criterion: a fixture row exceeding 32 KiB item pre-aggregation is truncated, never passed through raw", () => {
  it("passes a small row through unchanged", () => {
    const row = { service: "checkout", latencyMs: 120 };
    expect(truncateRowToItemBudget(row)).toEqual(row);
  });

  it("shrinks an oversized row until it satisfies the item budget", () => {
    const oversized = { service: "checkout", payload: "x".repeat(ITEM_BUDGET_BYTES * 2) };
    expect(() => JSON.stringify(oversized).length).not.toThrow(); // sanity: the fixture really is huge
    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeGreaterThan(ITEM_BUDGET_BYTES);

    const truncated = truncateRowToItemBudget(oversized);
    expect(Buffer.byteLength(JSON.stringify(truncated), "utf8")).toBeLessThanOrEqual(
      ITEM_BUDGET_BYTES,
    );
    expect(truncated.service).toBe("checkout"); // small fields survive untouched
  });

  it("throws rather than silently passing through a row that cannot be shrunk under budget", () => {
    // Many small fields, none individually shrinkable below the 64-char
    // floor, whose SUM still exceeds the budget.
    const manyFields: Record<string, string> = {};
    for (let i = 0; i < 2000; i += 1) {
      manyFields[`field_${i}`] = "y".repeat(200);
    }
    expect(() => truncateRowToItemBudget(manyFields)).toThrow(/item budget/);
  });
});

describe("downsampleToResultBudget — exit criterion: results stay within the 256 KiB result budget", () => {
  it("passes a small result set through unchanged", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(downsampleToResultBudget(rows)).toEqual(rows);
  });

  it("downsamples an oversized result set (many rows, each individually within budget) until it fits", () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({ index: i, value: "z".repeat(50) }));
    expect(Buffer.byteLength(JSON.stringify(rows), "utf8")).toBeGreaterThan(RESULT_BUDGET_BYTES);

    const downsampled = downsampleToResultBudget(rows);
    expect(Buffer.byteLength(JSON.stringify(downsampled), "utf8")).toBeLessThanOrEqual(
      RESULT_BUDGET_BYTES,
    );
    expect(downsampled.length).toBeLessThan(rows.length);
    expect(downsampled.length).toBeGreaterThan(0);
  });

  it("adversarial-review LOW fix: the non-converging-filter collapse path (e.g. a 2-row oversized result) still satisfies the result budget explicitly, never skips the check", () => {
    // Two rows whose COMBINED size exceeds the result budget but whose
    // individual sizes are each comfortably within it — this is exactly
    // the shape that hits the "non-converging filter" collapse branch at
    // candidate.length === 2.
    const halfBudgetBlob = "a".repeat(Math.floor(RESULT_BUDGET_BYTES * 0.6));
    const rows = [{ blob: halfBudgetBlob }, { blob: halfBudgetBlob }];
    const downsampled = downsampleToResultBudget(rows);
    expect(downsampled.length).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(downsampled), "utf8")).toBeLessThanOrEqual(
      RESULT_BUDGET_BYTES,
    );
  });
});

describe("processGrafanaQueryResult — the full pipeline, before data leaves packages/connectors-grafana", () => {
  it("rejects a query with no time range before touching any row", () => {
    expect(() => processGrafanaQueryResult({ timeRange: undefined, rawRows: [{ a: 1 }] })).toThrow(
      GrafanaQueryValidationError,
    );
  });

  it("scopes, redacts, truncates, and downsamples in one pass, always ending within both budgets", () => {
    const rawRows = [
      { service: "checkout", apiToken: "sk-secret", payload: "p".repeat(ITEM_BUDGET_BYTES * 2) },
      ...Array.from({ length: 5000 }, (_, i) => ({
        service: "checkout",
        index: i,
        blob: "q".repeat(100),
      })),
    ];

    const result = processGrafanaQueryResult({
      timeRange: { from: "now-1h", to: "now" },
      fields: ["service", "apiToken", "index", "blob"],
      rawRows,
    });

    const totalBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    expect(totalBytes).toBeLessThanOrEqual(RESULT_BUDGET_BYTES);
    for (const row of result) {
      expect(Buffer.byteLength(JSON.stringify(row), "utf8")).toBeLessThanOrEqual(ITEM_BUDGET_BYTES);
    }
    // The secret-shaped field was redacted wherever it survived scoping.
    const anyLeakedToken = result.some(
      (row) => row.apiToken !== undefined && row.apiToken !== "[redacted]",
    );
    expect(anyLeakedToken).toBe(false);
  });
});

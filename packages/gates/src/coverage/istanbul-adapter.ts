import { z } from "zod";
import { assertValidPct, type CoverageSummary } from "./types.js";

/**
 * Istanbul adapter — parses `istanbul`/`c8`'s `coverage-summary.json`
 * format: `{ total: { lines: { pct }, branches: { pct }, ... } }`. The
 * `.total` object is already the aggregate across every file, so no
 * summation across per-file entries is needed here (unlike the raw `.info`
 * LCOV text format).
 */
const IstanbulMetricSchema = z
  .object({
    total: z.number(),
    covered: z.number(),
    skipped: z.number(),
    pct: z.union([z.number(), z.literal("Unknown")]),
  })
  .partial()
  .passthrough();

const IstanbulSummarySchema = z
  .object({
    total: z
      .object({
        lines: IstanbulMetricSchema,
        branches: IstanbulMetricSchema,
      })
      .passthrough(),
  })
  .passthrough();

export function parseIstanbulSummary(raw: unknown): CoverageSummary {
  const parsed = IstanbulSummarySchema.parse(raw);
  const linePct = typeof parsed.total.lines.pct === "number" ? parsed.total.lines.pct : 100;
  const branchPct = typeof parsed.total.branches.pct === "number" ? parsed.total.branches.pct : 100;
  assertValidPct(linePct, "istanbul linePct");
  assertValidPct(branchPct, "istanbul branchPct");
  return { linePct, branchPct, toolchain: "istanbul" };
}

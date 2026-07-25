import { z } from "zod";
import { assertValidPct, type CoverageSummary } from "./types.js";

/**
 * pytest-cov adapter — parses `coverage.py`'s `coverage json` report shape
 * (what `pytest --cov --cov-report=json` ultimately produces):
 * `{ totals: { covered_lines, num_statements, percent_covered,
 * covered_branches?, num_branches? } }`. Branch coverage is optional in
 * `coverage.py`'s own output (only present when `--cov-branch`/
 * `branch = True` was configured) — when `num_branches` is absent or zero,
 * `branchPct` reports 100% (nothing to miss), matching this package's other
 * adapters' "nothing found, nothing missed" convention.
 */
const PytestCovTotalsSchema = z
  .object({
    covered_lines: z.number(),
    num_statements: z.number(),
    percent_covered: z.number(),
    covered_branches: z.number().optional(),
    num_branches: z.number().optional(),
  })
  .passthrough();

const PytestCovReportSchema = z
  .object({
    totals: PytestCovTotalsSchema,
  })
  .passthrough();

export function parsePytestCovReport(raw: unknown): CoverageSummary {
  const parsed = PytestCovReportSchema.parse(raw);
  const linePct = parsed.totals.percent_covered;
  const numBranches = parsed.totals.num_branches ?? 0;
  const coveredBranches = parsed.totals.covered_branches ?? 0;
  const branchPct = numBranches === 0 ? 100 : (coveredBranches / numBranches) * 100;
  assertValidPct(linePct, "pytest-cov linePct");
  assertValidPct(branchPct, "pytest-cov branchPct");
  return { linePct, branchPct, toolchain: "pytest-cov" };
}

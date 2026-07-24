import { z } from "zod";
import type { ScanFinding } from "./types.js";

/**
 * Gitleaks adapter — parses gitleaks' `--report-format json` shape: a JSON
 * array of findings, each `{ Description, File, RuleID, Match, ... }`.
 * Every gitleaks finding is a detected SECRET — this adapter normalizes
 * every finding to severity `"critical"` unconditionally (a leaked
 * credential is never merely advisory).
 */
const GitleaksFindingSchema = z.object({
  Description: z.string(),
  File: z.string(),
  RuleID: z.string(),
  Match: z.string(),
});

const GitleaksReportSchema = z.array(GitleaksFindingSchema);

export type GitleaksReport = z.infer<typeof GitleaksReportSchema>;

export function parseGitleaksReport(raw: unknown): readonly ScanFinding[] {
  const parsed = GitleaksReportSchema.parse(raw);
  return parsed.map((finding) => ({
    scanner: "gitleaks",
    severity: "critical",
    detail: `${finding.RuleID}: ${finding.Description}`,
    path: finding.File,
  }));
}

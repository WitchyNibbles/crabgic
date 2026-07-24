import { z } from "zod";
import type { ScanFinding, ScanSeverity } from "./types.js";

/**
 * Semgrep adapter — parses semgrep's `--json` report shape:
 * `{ results: [{ check_id, path, extra: { severity, message } }] }`.
 * Modeled as a PARSER over fixture tool-output (roadmap/14's own "CRITICAL —
 * the engine-live record is FIXTURE-based" instruction extends identically
 * to the security-scanner binaries: "model the adapters as PARSERS over
 * fixture tool-output ... plus the digest-pin resolution/fail-closed logic").
 * Severity mapping: semgrep's own three levels `ERROR`/`WARNING`/`INFO` map
 * to `critical`/`medium`/`low` respectively — `ERROR` is semgrep's
 * strongest signal (a rule author explicitly marked the pattern as an
 * actionable defect), which this phase's CRITICAL/HIGH-blocks policy must
 * treat as blocking.
 */
const SemgrepResultSchema = z.object({
  check_id: z.string(),
  path: z.string(),
  extra: z.object({
    severity: z.enum(["ERROR", "WARNING", "INFO"]),
    message: z.string(),
  }),
});

const SemgrepReportSchema = z.object({
  results: z.array(SemgrepResultSchema),
});

export type SemgrepReport = z.infer<typeof SemgrepReportSchema>;

const SEVERITY_MAP: Readonly<Record<"ERROR" | "WARNING" | "INFO", ScanSeverity>> = {
  ERROR: "critical",
  WARNING: "medium",
  INFO: "low",
};

export function parseSemgrepReport(raw: unknown): readonly ScanFinding[] {
  const parsed = SemgrepReportSchema.parse(raw);
  return parsed.results.map((result) => ({
    scanner: "semgrep",
    severity: SEVERITY_MAP[result.extra.severity],
    detail: `${result.check_id}: ${result.extra.message}`,
    path: result.path,
  }));
}

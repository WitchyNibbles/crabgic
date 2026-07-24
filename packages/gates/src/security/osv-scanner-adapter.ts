import { z } from "zod";
import type { ScanFinding, ScanSeverity } from "./types.js";

/**
 * osv-scanner adapter — parses osv-scanner's `--format json` shape (OSV
 * schema-derived): `{ results: [{ source: { path }, packages: [{ package:
 * { name, version, ecosystem }, vulnerabilities: [{ id,
 * database_specific: { severity } }] }] }] }`. `database_specific.severity`
 * is OSV's own free-text severity band (`"CRITICAL"|"HIGH"|"MODERATE"|
 * "LOW"`, case-insensitive per the OSV schema) — this adapter lower-cases
 * it and maps OSV's `"MODERATE"` to this package's `"medium"` band (the two
 * vocabularies' only naming mismatch); any unrecognized value falls back to
 * `"high"` (a known-CVE with an unparseable severity is still a known CVE —
 * never silently dropped to `"info"`).
 */
const OsvVulnerabilitySchema = z.object({
  id: z.string(),
  database_specific: z.object({ severity: z.string() }).partial(),
});

const OsvPackageSchema = z.object({
  package: z.object({ name: z.string(), version: z.string(), ecosystem: z.string() }),
  vulnerabilities: z.array(OsvVulnerabilitySchema),
});

const OsvResultSchema = z.object({
  source: z.object({ path: z.string() }),
  packages: z.array(OsvPackageSchema),
});

const OsvReportSchema = z.object({
  results: z.array(OsvResultSchema),
});

export type OsvScannerReport = z.infer<typeof OsvReportSchema>;

const KNOWN_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

function normalizeSeverity(raw: string | undefined): ScanSeverity {
  const lower = (raw ?? "").toLowerCase();
  if (lower === "moderate") return "medium";
  if (KNOWN_SEVERITIES.has(lower)) return lower as ScanSeverity;
  return "high";
}

export function parseOsvScannerReport(raw: unknown): readonly ScanFinding[] {
  const parsed = OsvReportSchema.parse(raw);
  const findings: ScanFinding[] = [];
  for (const result of parsed.results) {
    for (const pkg of result.packages) {
      for (const vuln of pkg.vulnerabilities) {
        findings.push({
          scanner: "osv-scanner",
          severity: normalizeSeverity(vuln.database_specific.severity),
          detail: `${vuln.id} in ${pkg.package.name}@${pkg.package.version} (${pkg.package.ecosystem})`,
          path: result.source.path,
        });
      }
    }
  }
  return findings;
}

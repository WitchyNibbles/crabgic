import type { ScanFinding, ScanSeverity } from "@eo/detect";

/**
 * Normalized security-finding shape — reused verbatim from `@eo/detect`'s
 * own `ScanFinding`/`ScanSeverity` (`packages/detect/src/quarantine/
 * types.ts`, exported via its public barrel) rather than a second,
 * independently-declared union — roadmap/14 §In scope, "Root-cause policy
 * detectors" bullet: "same normalized-finding shape as the security
 * adapters." 12 already established `{scanner, severity, detail, path?}`
 * for its own quarantine-pipeline scanners; this phase's adapters (semgrep,
 * gitleaks, osv-scanner) and its root-cause detector all normalize down to
 * the SAME shape.
 */
export type { ScanFinding, ScanSeverity };

/** CRITICAL/HIGH findings block, per roadmap/14 §In scope, "Security checks" bullet. */
export function hasBlockingFinding(findings: readonly ScanFinding[]): boolean {
  return findings.some((f) => f.severity === "critical" || f.severity === "high");
}

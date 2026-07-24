/**
 * Secret scanner — the gitleaks-shaped scanner slot named in roadmap/12
 * §In scope, "Quarantine pipeline" bullet: "SBOM + scan
 * deps/licenses/secrets/scripts/hooks/prompts/permissions." A real
 * gitleaks binary is itself a supply-chain risk that must be bootstrapped
 * through this SAME pipeline with a vendored first-trust digest (§Risks:
 * "Scanners are themselves supply chain ... bootstrapped ... with
 * vendored first-trust digests") — no such pinned binary exists in this
 * repo's lockfile today (flagged in the phase-12 final report as a
 * deferred external dependency). This module is the always-available,
 * regex-based default scanner used ahead of that bootstrap — pluggable:
 * `./scan-stage.ts` accepts any `Scanner`, so a real gitleaks-backed one
 * can be swapped in later with no interface change.
 *
 * Exercises roadmap/12's own named threat: "secret token embedded in a
 * skill body" (§Test plan, "Security" bullet).
 */
import type { CandidateSource, ScanFinding } from "../types.js";
import type { Scanner } from "./types.js";

interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "anthropic-api-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-style-api-key", pattern: /sk-[A-Za-z0-9]{32,}/g },
  {
    name: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
];

function scanText(scannerName: string, path: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    // Fresh RegExp instance per call (avoid shared `lastIndex` state across files under a global flag).
    const matches = text.match(new RegExp(pattern.source, pattern.flags));
    if (matches === null || matches.length === 0) continue;
    findings.push({
      scanner: scannerName,
      severity: "critical",
      detail: `${name} pattern detected (${String(matches.length)} occurrence(s))`,
      path,
    });
  }
  return findings;
}

export const secretScanner: Scanner = {
  name: "secret-scanner",
  scan(candidate: CandidateSource): ScanFinding[] {
    const findings: ScanFinding[] = [];
    for (const file of candidate.files) {
      findings.push(...scanText(this.name, file.path, file.content));
    }
    return findings;
  },
};

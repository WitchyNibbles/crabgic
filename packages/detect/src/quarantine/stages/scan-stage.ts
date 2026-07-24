/**
 * Stage 4 (scan) — roadmap/12 §In scope, "Quarantine pipeline" bullet:
 * "(4) SBOM + scan deps/licenses/secrets/scripts/hooks/prompts/
 * permissions." Runs every registered scanner over the candidate and
 * aggregates their findings; the stage FAILS (blocks progression) iff any
 * finding is `high` or `critical` severity — every roadmap/12 seeded
 * threat (secret in skill body, malicious postinstall, over-broad plugin
 * hook) is `critical`/`high`, so this threshold is exactly what "quarantine
 * catches seeded threats" requires.
 */
import { secretScanner } from "../scanners/secret-scanner.js";
import { scriptScanner } from "../scanners/script-scanner.js";
import { permissionScanner } from "../scanners/permission-scanner.js";
import type { Scanner } from "../scanners/types.js";
import type { CandidateSource, ScanFinding, StageResult } from "../types.js";

export const DEFAULT_SCANNERS: readonly Scanner[] = [
  secretScanner,
  scriptScanner,
  permissionScanner,
];

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

export interface ScanStageOutcome {
  readonly result: StageResult;
  readonly findings: readonly ScanFinding[];
}

export function runScanStage(
  candidate: CandidateSource,
  scanners: readonly Scanner[] = DEFAULT_SCANNERS,
): ScanStageOutcome {
  const findings = scanners.flatMap((scanner) => scanner.scan(candidate));
  const blocking = findings.filter((f) => BLOCKING_SEVERITIES.has(f.severity));

  return {
    findings,
    result: {
      stage: "scan",
      passed: blocking.length === 0,
      detail:
        blocking.length === 0
          ? `${String(findings.length)} finding(s), none blocking`
          : `${String(blocking.length)} blocking (high/critical) finding(s) of ${String(findings.length)} total`,
    },
  };
}

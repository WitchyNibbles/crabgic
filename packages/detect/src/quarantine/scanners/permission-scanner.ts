/**
 * Permission-footprint scanner — exercises roadmap/12's own named seeded
 * threat: "over-broad plugin hook (wildcard path / unscoped `Bash(*)`)"
 * (§Test plan, "Security" bullet). Flags any declared permission pattern
 * that grants unrestricted shell execution or whole-filesystem/whole-home
 * read/write, rather than a narrowly-scoped pattern.
 */
import type { CandidateSource, ScanFinding } from "../types.js";
import type { Scanner } from "./types.js";

const UNSCOPED_BASH_PATTERNS = new Set(["Bash(*)", "Bash(**)", "*"]);

function isOverBroadReadWrite(pattern: string): boolean {
  // Matches Read(/**), Read(~/**), Write(/**), Write(~/**) — whole-filesystem
  // or whole-home read/write, as opposed to a narrowly scoped path.
  return /^(Read|Write)\((\/\*\*|~\/\*\*)\)$/.test(pattern);
}

export const permissionScanner: Scanner = {
  name: "permission-scanner",
  scan(candidate: CandidateSource): ScanFinding[] {
    const findings: ScanFinding[] = [];
    for (const pattern of candidate.permissionFootprint) {
      if (UNSCOPED_BASH_PATTERNS.has(pattern)) {
        findings.push({
          scanner: "permission-scanner",
          severity: "critical",
          detail: `unscoped shell-execution permission requested: ${pattern}`,
        });
        continue;
      }
      if (isOverBroadReadWrite(pattern)) {
        findings.push({
          scanner: "permission-scanner",
          severity: "high",
          detail: `over-broad filesystem permission requested: ${pattern}`,
        });
      }
    }
    return findings;
  },
};

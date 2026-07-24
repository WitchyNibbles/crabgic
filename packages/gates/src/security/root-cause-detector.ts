import type { ScanFinding } from "./types.js";

/**
 * Root-cause policy detectors — roadmap/14 §In scope: "flag disabled
 * checks, broad exception swallowing, hidden fallbacks appearing in a
 * diff; configurable advisory→blocking; same normalized-finding shape as
 * the security adapters." Operates on unified-diff-style text: only
 * ADDED lines (`+`-prefixed, excluding the `+++` file-header line) are
 * scanned — a pre-existing disabled check the diff doesn't touch is not
 * this diff's own new risk.
 */

interface RootCauseRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const RULES: readonly RootCauseRule[] = [
  {
    id: "commented-out-assertion",
    description: "a commented-out assert/expect call",
    pattern: /^\+\s*(?:\/\/|#)\s*(?:assert|expect)\s*\(/i,
  },
  {
    id: "bare-except",
    description: "a bare 'except:' clause (Python) swallowing every exception",
    pattern: /^\+\s*except\s*:\s*$/,
  },
  {
    id: "broad-exception-swallow",
    description: "a broad 'except Exception' clause with no re-raise",
    pattern: /^\+\s*except\s+Exception\b\s*(?:as\s+\w+)?\s*:\s*(?:#.*)?$/i,
  },
  {
    id: "hidden-fallback-empty-catch",
    description: "an empty catch block silently swallowing an error",
    pattern: /^\+\s*}?\s*catch\s*(?:\([^)]*\))?\s*\{\s*\}?\s*$/,
  },
];

function addedLines(diffText: string): readonly string[] {
  return diffText.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

export interface RootCauseDetectorOptions {
  /** Advisory (non-blocking, severity "medium") by default; `true` elevates every finding to severity "high" so the standard CRITICAL/HIGH-blocks policy blocks on it — roadmap/14's own "configurable advisory→blocking." */
  readonly blocking?: boolean;
}

export function detectRootCausePolicyViolations(
  diffText: string,
  options: RootCauseDetectorOptions = {},
): readonly ScanFinding[] {
  const severity = options.blocking === true ? "high" : "medium";
  const findings: ScanFinding[] = [];
  for (const line of addedLines(diffText)) {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          scanner: "root-cause-policy",
          severity,
          detail: `${rule.description} (${rule.id}): ${line.trim()}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Script scanner — exercises roadmap/12's own named seeded threat:
 * "malicious `postinstall` (reverse-shell attempt)" (§Test plan,
 * "Security" bullet). Two independent signals: (1) ANY declared
 * `postinstall`/`preinstall`/`prepare` lifecycle script in a candidate's
 * `package.json` is inherently elevated risk (an industry-standard
 * heuristic — lifecycle scripts run unattended at install time) and is
 * always reported, at least at `medium`; (2) a reverse-shell / remote-code
 * pattern textually present anywhere in the candidate's files escalates to
 * `critical` regardless of which file it's in (an executable file OR a
 * referenced lifecycle-script file).
 */
import { parseJsonSafe } from "../../fs/safe-read.js";
import type { CandidateFile, CandidateSource, ScanFinding } from "../types.js";
import type { Scanner } from "./types.js";

const LIFECYCLE_SCRIPT_NAMES = ["preinstall", "postinstall", "prepare"] as const;

const REVERSE_SHELL_PATTERNS: readonly RegExp[] = [
  /\/dev\/tcp\//,
  /\bnc\s+-e\b/,
  /\bbash\s+-i\b/,
  /\bsh\s+-i\b/,
  /curl[^|\n]*\|\s*(sh|bash)\b/,
  /wget[^|\n]*\|\s*(sh|bash)\b/,
  /base64\s+-d\s*\|\s*(sh|bash)\b/,
  /child_process[^\n]{0,80}\.exec\(/,
];

function findLifecycleScripts(files: readonly CandidateFile[]): Record<string, string> {
  const packageJson = files.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );
  if (packageJson === undefined) return {};
  const parsed = parseJsonSafe(packageJson.content);
  if (typeof parsed !== "object" || parsed === null) return {};
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) return {};
  const out: Record<string, string> = {};
  for (const name of LIFECYCLE_SCRIPT_NAMES) {
    const value = (scripts as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim().length > 0) out[name] = value;
  }
  return out;
}

function reverseShellMatchIn(text: string): RegExp | undefined {
  return REVERSE_SHELL_PATTERNS.find((pattern) => pattern.test(text));
}

export const scriptScanner: Scanner = {
  name: "script-scanner",
  scan(candidate: CandidateSource): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const lifecycleScripts = findLifecycleScripts(candidate.files);

    for (const [scriptName, command] of Object.entries(lifecycleScripts)) {
      const matched = reverseShellMatchIn(command);
      findings.push({
        scanner: "script-scanner",
        severity: matched !== undefined ? "critical" : "medium",
        detail:
          matched !== undefined
            ? `${scriptName} lifecycle script contains a reverse-shell/remote-code pattern: ${command}`
            : `${scriptName} lifecycle script declared (elevated risk: runs unattended at install time): ${command}`,
        path: "package.json",
      });
    }

    for (const file of candidate.files) {
      if (file.path === "package.json") continue; // already covered above via lifecycleScripts
      const matched = reverseShellMatchIn(file.content);
      if (matched === undefined) continue;
      findings.push({
        scanner: "script-scanner",
        severity: "critical",
        detail: `reverse-shell/remote-code pattern detected in file content`,
        path: file.path,
      });
    }

    return findings;
  },
};

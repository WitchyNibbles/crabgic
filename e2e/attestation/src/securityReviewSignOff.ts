import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCheckResult, type AttestationCheckResult } from "./checkResult.js";
import { extractCitedPaths } from "./releaseDocsCommitted.js";

/**
 * `security-review-sign-off` — roadmap/23 Exit criteria: "No unresolved
 * CRITICAL/HIGH security finding; threat-model review sign-off recorded
 * with implementation cross-references (03/16 keystones + 17's lint
 * surface)", and work item 8: "review BLOCKS while any CRITICAL/HIGH
 * finding is open (mirrors 14's gate semantics)".
 *
 * Checked against the real review artifact, `docs/security-posture.md`:
 *
 *   1. SIGN-OFF RECORDED — the `## Sign-off` section exists and is not
 *      empty.
 *   2. REVIEWED AGAINST A BASELINE — `docs/threat-model.md` (owned by 02)
 *      is present; a sign-off with nothing to review against is not one.
 *   3. NO OPEN CRITICAL/HIGH — every CRITICAL/HIGH row in the findings
 *      table carries a fix, and no row is marked open/unresolved/deferred.
 *   4. CROSS-REFERENCES RESOLVE — every repo path cited in a CRITICAL/HIGH
 *      row's Evidence cell exists. "Recorded with implementation
 *      cross-references" is only satisfied if those references point at
 *      something real; a dangling one is an unverifiable sign-off.
 *
 * Zero parsed rows is a FAIL, not a vacuous PASS: it means the table moved
 * or the parser broke, and "no rows found" must never be mistaken for "no
 * findings exist" (`e2e/report/src/schema.ts`'s default-deny invariant).
 */
export const SECURITY_POSTURE_PATH = "docs/security-posture.md";
export const THREAT_MODEL_PATH = "docs/threat-model.md";
export const SECURITY_SIGN_OFF_HEADING = "## Sign-off";
export const FINDINGS_TABLE_HEADING = "## CRITICAL/HIGH findings found and fixed";

/**
 * How an unresolved finding is actually recognised.
 *
 * A first attempt scanned the whole Fix cell for status words
 * (`OPEN|PENDING|DEFERRED|...`). Run against the real
 * `docs/security-posture.md`, that produced a FALSE FAILURE on a fully
 * resolved gateway finding whose fix reads: "`mutation-pipeline.ts` now
 * owns the full `pending → recorded/conflict/failed` state machine ...
 * using the same `operationId` for the pending write". Both occurrences of
 * `pending` name a STATE, not the finding's status — and a release gate
 * that blocks on a landed fix because its description mentions a state
 * machine is worse than no gate at all.
 *
 * Status in this table is asserted one of two ways, so those are what is
 * matched: a status marker LEADING the cell, or an explicit unresolved
 * PHRASE. An incidental status-shaped word mid-sentence is neither.
 */
const LEADING_STATUS_MARKER =
  /^\s*\*{0,2}\s*(OPEN|UNRESOLVED|PENDING|DEFERRED|WONTFIX|NOT FIXED)\b/i;
const UNRESOLVED_PHRASE =
  /\b(still open|remains open|not fixed|no fix recorded|won'?t fix|open finding|left unresolved)\b/i;

/**
 * Strips markdown code spans before scanning for status markers.
 *
 * Without this, the marker scan produces false failures on perfectly
 * resolved findings: the real `docs/security-posture.md` describes one
 * gateway fix as making a module "own the full `pending → recorded/conflict/
 * failed` state machine". That `pending` is a STATE NAME inside a code span,
 * not a status claim about the finding — but a naive scan reads it as
 * "this finding is pending" and blocks the release on a fix that landed.
 * Prose asserts status; code spans name identifiers, so only prose is
 * scanned.
 */
export function stripCodeSpans(text: string): string {
  return text.replace(/`[^`]*`/g, " ");
}

const BLOCKING_SEVERITIES = ["CRITICAL", "HIGH"] as const;

export interface SecurityFinding {
  readonly surface: string;
  readonly severity: string;
  readonly finding: string;
  readonly fix: string;
  readonly evidence: string;
}

/** Extracts a `## `-delimited section body, or `undefined` when the heading is absent. */
export function extractSection(markdown: string, heading: string): string | undefined {
  const start = markdown.indexOf(heading);
  if (start === -1) return undefined;
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Parses the findings table's data rows. The table's columns are
 * `Surface | Severity | Finding | Fix | Evidence`; the header and the
 * `---` separator row are skipped, as is any row without the full five
 * cells (a malformed row is never silently coerced into a finding).
 */
export function parseFindingsTable(section: string): readonly SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const [surface = "", severity = "", finding = "", fix = "", evidence = ""] = cells;
    if (/^-+$/.test(surface) || severity.toLowerCase() === "severity") continue;
    findings.push({ surface, severity, finding, fix, evidence });
  }
  return findings;
}

export interface CheckSecurityReviewSignOffInput {
  readonly signOffSection: string | undefined;
  readonly findings: readonly SecurityFinding[];
  readonly threatModelPresent: boolean;
  readonly pathExists: (repoRelativePath: string) => boolean;
}

export function isBlockingSeverity(severity: string): boolean {
  const upper = severity.toUpperCase();
  return BLOCKING_SEVERITIES.some((blocking) => upper.includes(blocking));
}

/** Pure core — every input injected, so each blocking condition is testable against a seeded fixture. */
export function checkSecurityReviewSignOff(
  input: CheckSecurityReviewSignOffInput,
): AttestationCheckResult {
  const reasons: string[] = [];
  const details: string[] = [];

  if (input.signOffSection === undefined || input.signOffSection.trim() === "") {
    reasons.push(
      `no "${SECURITY_SIGN_OFF_HEADING}" section in ${SECURITY_POSTURE_PATH} — ` +
        "the threat-model review sign-off is not recorded.",
    );
  } else {
    details.push(`sign-off recorded (${input.signOffSection.trim().length} chars).`);
  }

  if (!input.threatModelPresent) {
    reasons.push(
      `${THREAT_MODEL_PATH} is absent — the review has no baseline to sign off against.`,
    );
  }

  const blocking = input.findings.filter((finding) => isBlockingSeverity(finding.severity));
  if (input.findings.length === 0) {
    reasons.push(
      `no findings rows parsed from "${FINDINGS_TABLE_HEADING}" — zero rows is treated as a broken ` +
        "or moved table, never as proof that no CRITICAL/HIGH finding exists.",
    );
  }
  details.push(`${blocking.length} CRITICAL/HIGH row(s) of ${input.findings.length} parsed.`);

  for (const finding of blocking) {
    const label = `${finding.severity} on ${finding.surface}`;
    const fixProse = stripCodeSpans(finding.fix);
    if (
      finding.fix === "" ||
      LEADING_STATUS_MARKER.test(finding.fix) ||
      UNRESOLVED_PHRASE.test(fixProse)
    ) {
      reasons.push(`${label}: still open — no recorded fix ("${finding.fix.slice(0, 80)}").`);
    }
    if (finding.evidence === "") {
      reasons.push(`${label}: no implementation cross-reference recorded.`);
      continue;
    }
    const dangling = extractCitedPaths(finding.evidence).filter((path) => !input.pathExists(path));
    if (dangling.length > 0) {
      reasons.push(
        `${label}: cross-reference(s) do not resolve — ${dangling.join(", ")} absent from the release candidate.`,
      );
    }
  }

  return buildCheckResult(reasons, details);
}

export function readSecurityReviewInput(repoRoot: string): CheckSecurityReviewSignOffInput {
  const posturePath = join(repoRoot, SECURITY_POSTURE_PATH);
  const markdown = existsSync(posturePath) ? readFileSync(posturePath, "utf-8") : "";
  const findingsSection = extractSection(markdown, FINDINGS_TABLE_HEADING);
  const signOffSection = extractSection(markdown, SECURITY_SIGN_OFF_HEADING);

  return {
    signOffSection,
    findings: findingsSection === undefined ? [] : parseFindingsTable(findingsSection),
    threatModelPresent: existsSync(join(repoRoot, THREAT_MODEL_PATH)),
    pathExists: (repoRelativePath) => existsSync(join(repoRoot, repoRelativePath)),
  };
}

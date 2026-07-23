import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Evidence-required-claims stage — roadmap/17 work item 7: "fixed/resolved/
 * verified/working/completed must carry an evidence reference." An
 * "evidence reference" (this module's own, documented reading — no other
 * phase text defines the concrete marker shape) is any of: an `https://`
 * URL, a Jira-style ticket key (`ABC-123`) whose letter-prefix is not a
 * known standard/hash-name false positive (`SHA-256`, `COVID-19`, `UTF-8`
 * — see `NON_TICKET_PREFIXES`), or an explicit `evidence:`/`ref:` label
 * whose content is a genuine reference — NOT a placeholder/negative value
 * (`none`, `n/a`, `tbd`, `unknown`, `not provided`, ...).
 *
 * The placeholder exclusion matters concretely: `review_comment` and
 * `jira_milestone_comment` are schema-required (by this pipeline's own
 * `schemaValidationStage`) to always carry an `Evidence:` line — without
 * excluding placeholder content, a candidate could satisfy this stage by
 * writing `Evidence: none provided` next to an unevidenced "fixed" claim,
 * which is exactly the gap this stage exists to close (see the corpus
 * fixture `attack-unevidenced-claim.json`).
 */

export const STAGE_NAME_EVIDENCE_CLAIMS = "evidence-claims";

const CLAIM_WORD_PATTERN = /\b(fixed|resolved|verified|working|completed)\b/gi;

const URL_PATTERN = /https:\/\/\S+/;

// M3 fix (adversarial-review MEDIUM): the original ticket-key pattern
// (`\b[A-Z][A-Z0-9]+-\d+\b`) matched any uppercase-letters-then-digits
// shape, so common standard/hash tokens that are NOT ticket references —
// `SHA-256`, `COVID-19`, `UTF-8` — satisfied the evidence requirement and
// let an unevidenced claim wave through. A fixed denylist of known
// non-ticket prefixes is checked against each candidate match; a prefix on
// the denylist is never accepted as a genuine ticket-key evidence marker.
const TICKET_KEY_PATTERN = /\b([A-Z][A-Z0-9]+)-\d+\b/g;

const NON_TICKET_PREFIXES = new Set([
  "SHA",
  "MD5",
  "UTF",
  "ISO",
  "IEEE",
  "ANSI",
  "ASCII",
  "ECMA",
  "HTML",
  "HTTP",
  "HTTPS",
  "CSS",
  "XML",
  "JSON",
  "COVID",
  "GDPR",
  "OWASP",
  "RFC",
  "CVE",
  "TLS",
  "SSL",
  "URI",
  "URL",
  "API",
]);

function hasGenuineTicketKey(text: string): boolean {
  const pattern = new RegExp(TICKET_KEY_PATTERN.source, TICKET_KEY_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1]!.toUpperCase();
    if (!NON_TICKET_PREFIXES.has(prefix)) {
      return true;
    }
  }
  return false;
}

const EVIDENCE_LABEL_PATTERN = /\b(?:evidence|ref)\s*:\s*(\S.*)$/gim;

const PLACEHOLDER_CONTENT_PATTERN = /^(none|n\/a|na|tbd|unknown|not\s+provided|provided)\b/i;

function hasGenuineEvidenceLabel(text: string): boolean {
  const pattern = new RegExp(EVIDENCE_LABEL_PATTERN.source, EVIDENCE_LABEL_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const content = match[1]!.trim();
    if (content.length > 0 && !PLACEHOLDER_CONTENT_PATTERN.test(content)) {
      return true;
    }
  }
  return false;
}

function findAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push(match);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return matches;
}

export function evidenceClaimsStage(input: LintStageInput): readonly LintFinding[] {
  const text = input.candidate;
  const claims = findAllMatches(text, CLAIM_WORD_PATTERN);
  if (claims.length === 0) return [];

  const hasEvidence = URL_PATTERN.test(text) || hasGenuineTicketKey(text) || hasGenuineEvidenceLabel(text);
  if (hasEvidence) return [];

  return claims.map((match) => ({
    stage: STAGE_NAME_EVIDENCE_CLAIMS,
    severity: "block" as const,
    message: `completion claim "${match[0]}" requires an evidence reference (a URL, ticket key, or a non-placeholder evidence:/ref: marker) somewhere in the artifact`,
    span: { start: match.index, end: match.index + match[0].length },
  }));
}

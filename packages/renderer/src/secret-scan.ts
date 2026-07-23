import type { LintFinding, LintStageInput } from "./lint-types.js";

/**
 * Secret/credential scan stage — roadmap/17 work item 3. Fixed, curated
 * pattern set (not a generic ML-style detector): AWS-style access keys, PEM
 * private-key headers, DB connection strings with embedded credentials, and
 * a small set of common bearer/PAT-shaped token prefixes. Out of scope
 * (roadmap/17 §Out of scope): source-diff SAST/dependency scanning — this
 * covers rendered outbound text only.
 */

export const STAGE_NAME_SECRET_SCAN = "secret-scan";

interface SecretPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { label: "AWS-style access key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    label: "PEM private-key header",
    pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: "database connection string with embedded credentials",
    pattern: /\b(?:postgres|mysql|mongodb):\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/g,
  },
  { label: "GitHub-style personal access token", pattern: /gh[pousr]_[A-Za-z0-9]{36}/g },
  // C1 fix (adversarial-review CRITICAL): the original single generic
  // `sk-[A-Za-z0-9]{20,}` pattern excluded hyphens from its body, so modern
  // hyphenated key formats (Anthropic `sk-ant-...`, OpenAI `sk-proj-...`)
  // broke the match at the FIRST internal hyphen and passed clean. Three
  // patterns now: two vendor-specific (clearer finding messages) plus a
  // hyphen-inclusive generic fallback so an unrecognized `sk-` vendor
  // prefix is still caught.
  { label: "Anthropic-style API key (sk-ant-*)", pattern: /sk-ant-[A-Za-z0-9-]{10,}/g },
  { label: "OpenAI-style project API key (sk-proj-*)", pattern: /sk-proj-[A-Za-z0-9-]{10,}/g },
  { label: "generic API-style secret key", pattern: /sk-[A-Za-z0-9-]{20,}/g },
  // H1 fix (adversarial-review HIGH): GCP-style API key, fixed 39-char
  // shape (`AIza` + 35 URL-safe base64 chars).
  { label: "GCP-style API key (AIza*)", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  // H2 fix (adversarial-review HIGH): modern GitHub fine-grained PAT
  // (`github_pat_...`, longer/differently-shaped than the classic
  // `gh[pousr]_`-prefixed 36-char token above) plus a raw JWT (three
  // base64url segments dot-separated, header segment always starts with
  // "ey" since a JSON object's `{"` prefix base64-encodes to that) that
  // carries no `Bearer` prefix at all.
  {
    label: "GitHub fine-grained personal access token (github_pat_*)",
    pattern: /github_pat_[A-Za-z0-9_]{20,}/g,
  },
  {
    label: "JWT (JSON Web Token)",
    pattern: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  { label: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9\-_.]{16,}/g },
];

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

/**
 * The secret/credential scan stage: every `ArtifactKind` is scanned
 * identically — this pipeline stage does not vary by kind, per roadmap/17
 * §Test plan's "Security" bullet ("caught pre-render across every
 * `ArtifactKind`").
 */
export function secretScanStage(input: LintStageInput): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    for (const match of findAllMatches(input.candidate, pattern)) {
      findings.push({
        stage: STAGE_NAME_SECRET_SCAN,
        severity: "block",
        message: `${label} detected in rendered text — secrets must never appear in outbound communication`,
        span: { start: match.index, end: match.index + match[0].length },
      });
    }
  }
  return findings;
}

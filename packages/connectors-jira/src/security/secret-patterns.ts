/**
 * Shared secret-shaped-content pattern set — reused by
 * `../attachments/attachment-pipeline.ts` (binary attachment content) and
 * `../resource-client/adf-guard.ts` (ADF-extracted plain text), so the
 * pattern list is maintained in exactly one place rather than drifting
 * across the two independent scan sites.
 *
 * CONSTRAINT on adding patterns here — `adf-guard.ts` runs this set TWICE
 * per document: once over the extracted plain text, and once over the
 * document's `JSON.stringify` serialization (that second scan is what
 * catches a secret in a link `href` or in an unknown extra member, neither
 * of which appears in the extracted text). The two subjects are not
 * equivalent, and the difference is JSON escaping:
 *
 *  - literal control characters (newline, tab, CR) become the two-character
 *    escapes `\n`/`\t`/`\r` in the serialization, so `\s`-bearing patterns —
 *    e.g. `aws_secret_access_key\s*=` below — match on the text path but can
 *    MISS on the serialization path;
 *  - `"` and `\` are backslash-escaped there too.
 *
 * So neither scan subsumes the other, which is exactly why `adf-guard.ts`
 * keeps both rather than "simplifying" to the serialization alone. A new
 * pattern that depends on literal whitespace, quote, or backslash characters
 * is effectively text-scan-only and needs its own review before being
 * relied on for content hidden outside `node.text`.
 *
 * Every pattern added on 2026-09-06 is serialization-safe under that rule:
 * none depends on a literal newline, tab, quote or backslash. `Bearer\s+` is
 * the only one touching `\s`, and the space it matches survives JSON encoding
 * unchanged — a newline there would not, which is exactly the case the
 * paragraph above warns about.
 */
export const JIRA_SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key header
  /aws_secret_access_key\s*=/i,
  // ⚠️ THE SIBLING CONNECTOR ALREADY REFUSED THESE TWO. Grafana's
  // `CREDENTIAL_SHAPED_CONTENT_PATTERNS` carries `Bearer …` and the JWT triple
  // (`security/redaction.ts`), so until 2026-09-06 the same worker-authored
  // text was redacted on its way to Grafana and posted verbatim to Jira.
  // Spelled identically to that set so the two cannot drift apart silently.
  /Bearer\s+[A-Za-z0-9._-]{16,}/i,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  // The credentials a worker in THIS repository actually holds, plus the one
  // this connector authenticates with — a worker pasting a failing command's
  // output into a comment is the ordinary path by which each arrives here.
  /ghp_[A-Za-z0-9]{36}/, // GitHub personal access token (classic)
  /github_pat_[A-Za-z0-9_]{50,}/, // GitHub personal access token (fine-grained)
  /sk-ant-[A-Za-z0-9-]{20,}/, // Anthropic API key
  /ATATT[A-Za-z0-9_\-=]{20,}/, // Atlassian API token
];

/** `true` iff `text` contains any secret-shaped substring — never returns the match itself. */
export function containsSecretShapedContent(text: string): boolean {
  return JIRA_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

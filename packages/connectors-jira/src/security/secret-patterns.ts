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
 */
export const JIRA_SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key header
  /aws_secret_access_key\s*=/i,
];

/** `true` iff `text` contains any secret-shaped substring — never returns the match itself. */
export function containsSecretShapedContent(text: string): boolean {
  return JIRA_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

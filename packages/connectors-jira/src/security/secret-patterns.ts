/**
 * Shared secret-shaped-content pattern set — reused by
 * `../attachments/attachment-pipeline.ts` (binary attachment content) and
 * `../resource-client/adf-guard.ts` (ADF-extracted plain text), so the
 * pattern list is maintained in exactly one place rather than drifting
 * across the two independent scan sites.
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

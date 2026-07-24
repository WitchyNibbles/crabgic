/**
 * Shared secret-redaction primitives — extracted (adversarial-review
 * MEDIUM finding) so `../query/query-layer.ts` (row-level redaction) and
 * `../resources/definitions/{contact-point,notification-template}.ts`
 * (resource-serializer redaction) apply the exact SAME rules from one
 * place, rather than two independently-maintained pattern lists that could
 * drift apart.
 *
 * roadmap/20-grafana-adapters.md names contact-point `settings` and
 * notification-template `template` as fields that can carry live secret
 * material (a webhook URL's embedded token, an SMTP password, a PagerDuty
 * integration key, or — for a hand-authored template body — a
 * copy-pasted credential). This module redacts BOTH before that data ever
 * enters a rollback snapshot (`../mutation/snapshot-store.ts`), a
 * canonical read-back-compare result (attachable to an `EvidenceRecord`
 * per roadmap/20 §Interfaces produced), or the desired-state comparison
 * baseline `../mutation/mutation-apply-client.ts`'s `verify()` computes —
 * defense-in-depth, regardless of whether Grafana's own API already
 * separates "secure settings" into their own channel.
 */

export const REDACTED_PLACEHOLDER = "[redacted]";

/** Key-name patterns treated as secret-shaped — same vocabulary `../query/query-layer.ts` applies to query rows, now the single shared definition. */
const SECRET_LIKE_KEY_PATTERN =
  /token|secret|password|api[-_]?key|authorization|bearer|credential/i;

/**
 * Recursively redacts any object/array whose KEY matches
 * `SECRET_LIKE_KEY_PATTERN`, at any nesting depth — a webhook contact
 * point's `settings.authorization`/`settings.password` is redacted just
 * as reliably as a top-level field. Primitives (and `null`/`undefined`)
 * pass through unchanged; only a secret-NAMED key's value is ever
 * replaced, never a value whose own content merely looks secret-shaped
 * (that content-based check is `redactCredentialShapedText`'s job, for
 * free-text fields that carry no key structure of their own).
 */
export function redactSecretBearingObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecretBearingObject);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_LIKE_KEY_PATTERN.test(key)
        ? REDACTED_PLACEHOLDER
        : redactSecretBearingObject(nested);
    }
    return result;
  }
  return value;
}

/** Credential-shaped CONTENT patterns (not key names) — for free-text fields like a notification template body, where a secret has no surrounding key to key off of. Deliberately narrow (real credential prefixes/shapes only) to avoid false-positive redaction of ordinary template syntax. */
const CREDENTIAL_SHAPED_CONTENT_PATTERNS: readonly RegExp[] = [
  /glsa_[A-Za-z0-9]{20,}/g,
  /glc_[A-Za-z0-9+/=]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
];

/** Redacts any credential-SHAPED substring inside free text (never a blanket redaction of the whole string) — used for notification-template bodies, which carry no key structure `redactSecretBearingObject` could key off of. */
export function redactCredentialShapedText(text: string): string {
  let result = text;
  for (const pattern of CREDENTIAL_SHAPED_CONTENT_PATTERNS) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER);
  }
  return result;
}

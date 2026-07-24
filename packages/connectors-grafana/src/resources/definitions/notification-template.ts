import type {
  GrafanaParsedResource,
  GrafanaResourceDefinition,
  GrafanaResourceSummary,
} from "../resource-definitions.js";
import { redactCredentialShapedText } from "../../security/redaction.js";
import {
  buildResourceSummary,
  parseJsonBody,
  pickCanonicalFields,
  revisionFromEtagOrField,
} from "./shared.js";

const CANONICAL_FIELD_KEYS = ["name", "template"] as const;

/**
 * Redacts any credential-shaped substring embedded in a template body
 * (adversarial-review MEDIUM finding: `template` is free text captured
 * verbatim — a hand-authored template could carry a copy-pasted
 * credential). Content-pattern-based (never key-based, since `template`
 * is a single string field with no sub-keys of its own) — applied
 * identically on both sides of the `verify()` comparison, matching
 * `contact-point.ts`'s own settings-redaction symmetry.
 */
function redactNotificationTemplateInput(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...input,
    template:
      typeof input.template === "string"
        ? redactCredentialShapedText(input.template)
        : input.template,
  };
}

/** Notification-template client (provisioning API, `/api/v1/provisioning/templates`) — every create/update on this kind carries the "notification templates" `HighImpactCapabilityFlag` (`../../mutation/high-impact-tagging.js`). Revision source: `ETag` header. */
export const notificationTemplateDefinition: GrafanaResourceDefinition = {
  kind: "notification-template",

  buildListRequest: (basePath) => ({ method: "GET", path: basePath }),

  buildGetRequest: (basePath, externalId) => ({
    method: "GET",
    path: `${basePath}/${encodeURIComponent(externalId)}`,
  }),

  buildCreateRequest: (basePath, input, deterministicUid) => ({
    method: "POST",
    path: basePath,
    body: { ...input, uid: deterministicUid },
  }),

  buildUpdateRequest: (basePath, externalId, input, expectedRevision) => ({
    method: "PUT",
    path: `${basePath}/${encodeURIComponent(externalId)}`,
    body: { ...input, uid: externalId },
    headers: { "If-Match": expectedRevision },
    hasPrecondition: true,
  }),

  parseList: (bodyText): readonly GrafanaResourceSummary[] => {
    const parsed: unknown = JSON.parse(bodyText.length > 0 ? bodyText : "[]");
    if (!Array.isArray(parsed)) {
      throw new Error("expected a JSON array body for notification-template list");
    }
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.uid), obj.name);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    return {
      kind: "notification-template",
      externalId,
      revision: revisionFromEtagOrField(headers, raw.version as string | number | undefined),
      fields: pickCanonicalFields(redactNotificationTemplateInput(raw), CANONICAL_FIELD_KEYS),
    };
  },

  // Redacts `template` on BOTH sides of the verify() comparison (never on
  // the actual outbound wire body) — adversarial-review MEDIUM fix.
  canonicalizeDesiredInput: (input) => redactNotificationTemplateInput(input),
};

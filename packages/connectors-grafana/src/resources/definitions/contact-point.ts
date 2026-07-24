import type {
  GrafanaParsedResource,
  GrafanaResourceDefinition,
  GrafanaResourceSummary,
} from "../resource-definitions.js";
import { redactSecretBearingObject } from "../../security/redaction.js";
import {
  buildResourceSummary,
  parseJsonBody,
  pickCanonicalFields,
  revisionFromEtagOrField,
} from "./shared.js";

const CANONICAL_FIELD_KEYS = ["name", "type", "settings"] as const;

/**
 * Redacts secret-bearing sub-fields of `settings` (adversarial-review
 * MEDIUM finding: a webhook contact point's `settings.authorization`,
 * an SMTP `settings.password`, a PagerDuty `settings.integrationKey`, etc.
 * were captured verbatim into `GrafanaParsedResource.fields` — which
 * becomes a rollback snapshot, a plan-payload comparison baseline, and a
 * canonical read-back-compare result attachable to an `EvidenceRecord`).
 * Applied identically on BOTH sides — the remote read-back
 * (`parseCanonical`) and the desired-state comparison baseline
 * (`canonicalizeDesiredInput`) — so `verify()` never spuriously mismatches
 * on a value redacted on only one side. NEVER applied to the actual
 * outbound wire body (`buildCreateRequest`/`buildUpdateRequest` always
 * send the caller's real `input` — a redacted webhook URL sent to Grafana
 * would corrupt the actual contact point).
 */
function redactContactPointInput(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...input, settings: redactSecretBearingObject(input.settings) };
}

/** Contact-point client (provisioning API, `/api/v1/provisioning/contact-points`) — every create/update on this kind carries the "contact points" `HighImpactCapabilityFlag` (`../../mutation/high-impact-tagging.js`). Revision source: `ETag` header. */
export const contactPointDefinition: GrafanaResourceDefinition = {
  kind: "contact-point",

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
      throw new Error("expected a JSON array body for contact-point list");
    }
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.uid), obj.name);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    return {
      kind: "contact-point",
      externalId,
      revision: revisionFromEtagOrField(headers, raw.version as string | number | undefined),
      fields: pickCanonicalFields(redactContactPointInput(raw), CANONICAL_FIELD_KEYS),
    };
  },

  // Redacts settings on BOTH sides of the verify() comparison (never on
  // the actual outbound wire body) — adversarial-review MEDIUM fix.
  canonicalizeDesiredInput: (input) => redactContactPointInput(input),
};

import type {
  GrafanaParsedResource,
  GrafanaResourceDefinition,
  GrafanaResourceSummary,
} from "../resource-definitions.js";
import {
  buildResourceSummary,
  parseJsonBody,
  pickCanonicalFields,
  revisionFromEtagOrField,
} from "./shared.js";

const CANONICAL_FIELD_KEYS = ["title", "folderUID", "ruleGroup", "condition", "isPaused"] as const;

/** Grafana-managed alert-rule client (provisioning API, `/api/v1/provisioning/alert-rules`) — uid-addressable, `ETag`-based optimistic concurrency. `isPaused` is the field the "alert disabling" `HighImpactCapabilityFlag` (`../../mutation/high-impact-tagging.js`) specifically guards. */
export const alertRuleDefinition: GrafanaResourceDefinition = {
  kind: "alert-rule",

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
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array body for alert-rule list");
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.uid), obj.title);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    return {
      kind: "alert-rule",
      externalId,
      revision: revisionFromEtagOrField(headers, raw.version as string | number | undefined),
      fields: pickCanonicalFields(raw, CANONICAL_FIELD_KEYS),
    };
  },

  // The injected `uid` never overlaps CANONICAL_FIELD_KEYS — identity
  // (adversarial-review HIGH fix's general interface).
  canonicalizeDesiredInput: (input) => input,
};

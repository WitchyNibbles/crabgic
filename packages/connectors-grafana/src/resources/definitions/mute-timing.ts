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

const CANONICAL_FIELD_KEYS = ["name", "time_intervals"] as const;

/** Mute-timing client (provisioning API, `/api/v1/provisioning/mute-timings`) — every create/update on this kind carries the "mute timings" `HighImpactCapabilityFlag` (`../../mutation/high-impact-tagging.js`). Revision source: `ETag` header. */
export const muteTimingDefinition: GrafanaResourceDefinition = {
  kind: "mute-timing",

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
      throw new Error("expected a JSON array body for mute-timing list");
    }
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.uid), obj.name);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    return {
      kind: "mute-timing",
      externalId,
      revision: revisionFromEtagOrField(headers, raw.version as string | number | undefined),
      fields: pickCanonicalFields(raw, CANONICAL_FIELD_KEYS),
    };
  },

  // The injected `uid` never overlaps CANONICAL_FIELD_KEYS — identity
  // (adversarial-review HIGH fix's general interface).
  canonicalizeDesiredInput: (input) => input,
};

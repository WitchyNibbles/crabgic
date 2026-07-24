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

const CANONICAL_FIELD_KEYS = ["title", "parentUid"] as const;

/** Folder resource client — revision source: `ETag` header (folders carry no body-level version field in this connector's modeled shape). */
export const folderDefinition: GrafanaResourceDefinition = {
  kind: "folder",

  buildListRequest: (basePath) => ({ method: "GET", path: basePath }),

  buildGetRequest: (basePath, externalId) => ({
    method: "GET",
    path: `${basePath}/${encodeURIComponent(externalId)}`,
  }),

  buildCreateRequest: (basePath, input, deterministicUid) => ({
    method: "POST",
    path: basePath,
    body: { uid: deterministicUid, title: input.title, parentUid: input.parentUid },
  }),

  buildUpdateRequest: (basePath, externalId, input, expectedRevision) => ({
    method: "PUT",
    path: `${basePath}/${encodeURIComponent(externalId)}`,
    body: { title: input.title, parentUid: input.parentUid, overwrite: false },
    headers: { "If-Match": expectedRevision },
    hasPrecondition: true,
  }),

  parseList: (bodyText): readonly GrafanaResourceSummary[] => {
    const parsed: unknown = JSON.parse(bodyText.length > 0 ? bodyText : "[]");
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array body for folder list");
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.uid), obj.title);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    return {
      kind: "folder",
      externalId,
      revision: revisionFromEtagOrField(headers, raw.version as string | number | undefined),
      ...(typeof raw.url === "string" ? { canonicalUrl: raw.url } : {}),
      fields: pickCanonicalFields(raw, CANONICAL_FIELD_KEYS),
    };
  },

  // No create/update-time transformation touches a canonical field for
  // this kind (the injected uid is never itself a canonical field) —
  // identity (adversarial-review HIGH fix's general interface).
  canonicalizeDesiredInput: (input) => input,
};

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
import { FOLDER_ANNOTATION, appPlatformBehaviour } from "./app-platform.js";

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

  /**
   * App Platform shapes, confirmed against `grafana/grafana-oss:12.4.3`.
   *
   * `parentUid` is carried by the same `grafana.app/folder` metadata
   * annotation dashboards use for their folder — the App Platform models
   * "which folder contains this" uniformly, so a folder's parent and a
   * dashboard's folder are the same mechanism rather than two.
   *
   * The precondition also changes family: the classic folder update sends
   * `If-Match: <etag>`, while the App Platform takes
   * `metadata.resourceVersion` in the body and answers 409 Conflict. Both
   * are optimistic concurrency; only one of them is an HTTP header.
   */
  apis: {
    ...appPlatformBehaviour({
      kind: "folder",
      canonicalFieldKeys: CANONICAL_FIELD_KEYS,
      buildSpec: (input) => ({ title: input.title }),
      buildAnnotations: (input) =>
        typeof input.parentUid === "string" && input.parentUid.length > 0
          ? { [FOLDER_ANNOTATION]: input.parentUid }
          : undefined,
      // ABSENT ANNOTATION MEANS A TOP-LEVEL FOLDER, and for THIS kind that
      // canonicalises to `null` — deliberately NOT the `""` its dashboard
      // counterpart uses. The two differ because Grafana's own APIs differ,
      // verified against a live 12.4.3: the classic response for a top-level
      // folder omits `parentUid` entirely (so `pickCanonicalFields` yields
      // `null`), while a root dashboard's `meta.folderUid` is literally `""`.
      // Emitting the key here would canonicalise a top-level folder as `""`
      // and make it compare unequal to the same folder read through the
      // classic family. Returning nothing lets `pickCanonicalFields` supply
      // the `null` both families agree on.
      fieldsFromAnnotations: (annotations) =>
        typeof annotations[FOLDER_ANNOTATION] === "string"
          ? { parentUid: annotations[FOLDER_ANNOTATION] }
          : {},
    }),
    canonicalizeDesiredInput: (input) => input,
  },
};

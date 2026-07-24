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

const CANONICAL_FIELD_KEYS = ["text", "tags", "dashboardUID", "time"] as const;

/**
 * Injects this connector's deterministic create-marker into `tags` — the
 * SINGLE definition both `buildCreateRequest` (the actual outbound POST
 * body) and `canonicalizeDesiredInput` (the verify()/reconcileAmbiguous()
 * comparison baseline) call, so the two can never drift apart
 * (adversarial-review HIGH finding: they previously computed this
 * independently — `buildCreateRequest` injected the marker into the wire
 * body while the stored plan payload/comparison baseline did not, so a
 * genuinely successful annotation create's read-back NEVER matched the
 * un-marked baseline and `verify()` always returned `false`, reporting
 * every successful annotation write as `failed`).
 */
function injectAnnotationMarker(
  input: Readonly<Record<string, unknown>>,
  deterministicUid: string,
): Record<string, unknown> {
  return {
    ...input,
    tags: [
      ...((input.tags as readonly string[] | undefined) ?? []),
      `eo-marker:${deterministicUid}`,
    ],
  };
}

/**
 * Annotation resource client. Unlike the other 6 kinds, Grafana never
 * accepts a caller-supplied identifier for a new annotation (the numeric
 * `id` is server-assigned) — so this kind's create marker is carried in
 * the `tags` array instead of a deterministic uid (`../../reconciliation/
 * marker-reconciler.js` searches by tag for this kind specifically).
 * Revision source: `ETag` header (annotations carry no body-level version
 * field this connector's modeled shape tracks).
 */
export const annotationDefinition: GrafanaResourceDefinition = {
  kind: "annotation",

  buildListRequest: (basePath) => ({ method: "GET", path: basePath }),

  buildGetRequest: (basePath, externalId) => ({
    method: "GET",
    path: `${basePath}/${encodeURIComponent(externalId)}`,
  }),

  buildCreateRequest: (basePath, input, deterministicUid) => {
    const withMarker = injectAnnotationMarker(input, deterministicUid);
    return {
      method: "POST",
      path: basePath,
      body: {
        text: withMarker.text,
        tags: withMarker.tags,
        dashboardUID: withMarker.dashboardUID,
        time: withMarker.time,
      },
    };
  },

  buildUpdateRequest: (basePath, externalId, input, expectedRevision) => ({
    method: "PUT",
    path: `${basePath}/${encodeURIComponent(externalId)}`,
    body: { text: input.text, tags: input.tags, time: input.time },
    headers: { "If-Match": expectedRevision },
    hasPrecondition: true,
  }),

  parseList: (bodyText): readonly GrafanaResourceSummary[] => {
    const parsed: unknown = JSON.parse(bodyText.length > 0 ? bodyText : "[]");
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array body for annotation list");
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.id), obj.text);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    return {
      kind: "annotation",
      externalId,
      revision: revisionFromEtagOrField(headers, raw.updated as string | number | undefined),
      fields: pickCanonicalFields(raw, CANONICAL_FIELD_KEYS),
    };
  },

  // The ONLY kind whose create-time transformation touches a canonical
  // field (`tags`) — reuses the SAME `injectAnnotationMarker` helper
  // `buildCreateRequest` itself calls, so the two can never diverge.
  // Update never injects a marker (an update targets an already-known,
  // already-created annotation id) — identity there.
  canonicalizeDesiredInput: (input, context) =>
    context.action === "create" ? injectAnnotationMarker(input, context.deterministicUid) : input,
};

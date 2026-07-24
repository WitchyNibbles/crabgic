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

const CANONICAL_FIELD_KEYS = ["title", "tags", "folderUid"] as const;

/** Dashboard resource client — revision source: the classic dashboards API's own `dashboard.version` integer (roadmap/20 §In scope: "dashboard version is a REST precondition token only... never rendered as communication text"). GET is uid-addressable (`/uid/{uid}`); create/update both POST to `{basePath}/db` (Grafana's classic dashboards API is POST-for-both, never PUT). */
export const dashboardDefinition: GrafanaResourceDefinition = {
  kind: "dashboard",

  buildListRequest: (basePath) => ({ method: "GET", path: `${basePath}/search` }),

  buildGetRequest: (basePath, externalId) => ({
    method: "GET",
    path: `${basePath}/uid/${encodeURIComponent(externalId)}`,
  }),

  buildCreateRequest: (basePath, input, deterministicUid) => ({
    method: "POST",
    path: `${basePath}/db`,
    body: {
      dashboard: { uid: deterministicUid, title: input.title, tags: input.tags ?? [] },
      folderUid: input.folderUid,
      overwrite: false,
    },
  }),

  buildUpdateRequest: (basePath, externalId, input, expectedRevision) => ({
    method: "POST",
    path: `${basePath}/db`,
    body: {
      dashboard: {
        uid: externalId,
        title: input.title,
        tags: input.tags ?? [],
        version: Number(expectedRevision),
      },
      folderUid: input.folderUid,
      overwrite: false,
    },
    hasPrecondition: true,
  }),

  parseList: (bodyText): readonly GrafanaResourceSummary[] => {
    const parsed: unknown = JSON.parse(bodyText.length > 0 ? bodyText : "[]");
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array body for dashboard search");
    return parsed.map((entry) => {
      const obj = entry as Record<string, unknown>;
      return buildResourceSummary(String(obj.uid), obj.title);
    });
  },

  parseCanonical: (externalId, bodyText, headers): GrafanaParsedResource => {
    const raw = parseJsonBody(bodyText);
    const dashboard = (raw.dashboard as Record<string, unknown> | undefined) ?? raw;
    const meta = (raw.meta as Record<string, unknown> | undefined) ?? {};
    return {
      kind: "dashboard",
      externalId,
      revision: revisionFromEtagOrField(headers, dashboard.version as string | number | undefined),
      ...(typeof meta.url === "string" ? { canonicalUrl: meta.url } : {}),
      fields: pickCanonicalFields(
        { ...dashboard, folderUid: meta.folderUid ?? dashboard.folderUid },
        CANONICAL_FIELD_KEYS,
      ),
    };
  },

  // The injected `uid`/`version` fields never overlap CANONICAL_FIELD_KEYS
  // — identity (adversarial-review HIGH fix's general interface).
  canonicalizeDesiredInput: (input) => input,
};

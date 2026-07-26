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

  /**
   * App Platform shapes, confirmed against `grafana/grafana-oss:12.4.3`.
   *
   * `folderUid` is the one canonical field that does NOT live in `spec` here:
   * the App Platform records parentage as the `grafana.app/folder` metadata
   * annotation. It is written from the input and read back out of the
   * annotation, so "mutate → read-back → compare" still compares the same
   * three fields the classic family compares.
   */
  apis: {
    ...appPlatformBehaviour({
      kind: "dashboard",
      canonicalFieldKeys: CANONICAL_FIELD_KEYS,
      buildSpec: (input) => ({ title: input.title, tags: input.tags ?? [] }),
      buildAnnotations: (input) =>
        typeof input.folderUid === "string" && input.folderUid.length > 0
          ? { [FOLDER_ANNOTATION]: input.folderUid }
          : undefined,
      // ABSENT ANNOTATION MEANS THE ROOT FOLDER, and the root folder's
      // canonical `folderUid` in this connector is `""` — that is what the
      // classic API literally returns (`{"folderUid":"", ...}`) and what a
      // caller writes to place a dashboard at the root. Letting the key fall
      // through as absent instead would make `pickCanonicalFields` emit
      // `null`, so a root dashboard's desired `""` and its read-back `null`
      // would never compare equal and every such create would report
      // "read-back did not confirm the desired state". Normalising here is
      // also what lets a resource written through one family be read back
      // through the other and still compare equal.
      fieldsFromAnnotations: (annotations) => ({
        folderUid:
          typeof annotations[FOLDER_ANNOTATION] === "string" ? annotations[FOLDER_ANNOTATION] : "",
      }),
    }),
    canonicalizeDesiredInput: (input) => input,
  },
};

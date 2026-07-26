import type {
  GrafanaFamilyBehaviour,
  GrafanaParsedResource,
  GrafanaResourceSummary,
} from "../resource-definitions.js";
import { parseJsonBody, pickCanonicalFields } from "./shared.js";
import type { GrafanaResourceKind } from "../../resource-kinds.js";

/**
 * Grafana App Platform (`/apis`) request/response shapes — the Kubernetes-
 * style resource API that 12.x and later expose alongside the classic
 * `/api` surface.
 *
 * EVERY SHAPE HERE WAS VERIFIED AGAINST A REAL `grafana/grafana-oss:12.4.3`
 * CONTAINER, not inferred. That is the whole point of this module existing:
 * the classic builders were routed to `/apis` base paths for as long as the
 * route table has preferred that family, and every such write failed on the
 * wire while the package's hand-authored cassettes agreed with themselves.
 * A shape asserted from documentation would reproduce exactly that failure
 * mode, so the unit tests below are written from observed responses and
 * `../../../..`'s live binding exercises the path end to end.
 *
 * The observed contract, in brief:
 *
 * - **Create** — `POST {basePath}` with `{metadata: {name}, spec: {...}}`.
 *   The caller-chosen `name` IS the resource's external id (the same uid the
 *   classic API takes), so creates stay deterministic and replay-safe.
 * - **Update** — `PUT {basePath}/{name}` with `metadata.resourceVersion` set
 *   to the revision the caller expects. Grafana answers `409 Conflict`
 *   (`kind: "Status", reason: "Conflict"`) when it is stale, which is
 *   precisely the optimistic-concurrency precondition the classic
 *   dashboard `version` field provides — hence `hasPrecondition: true`.
 * - **Read** — `GET {basePath}/{name}`; **List** — `GET {basePath}`, whose
 *   body is `{items: [...]}` rather than a bare array.
 * - **Revision** — `metadata.resourceVersion`, a string. Never
 *   `spec.version`: the App Platform does not carry the classic dashboard
 *   version integer, and an ETag header is not sent for these routes.
 * - **Folder placement** — `metadata.annotations["grafana.app/folder"]`,
 *   not a `folderUid` body field.
 */

/** Where a dashboard's parent folder is recorded on an App Platform object. */
export const FOLDER_ANNOTATION = "grafana.app/folder";

interface AppPlatformObject {
  readonly metadata?: {
    readonly name?: unknown;
    readonly resourceVersion?: unknown;
    readonly annotations?: Readonly<Record<string, unknown>>;
  };
  readonly spec?: Readonly<Record<string, unknown>>;
  readonly items?: readonly unknown[];
}

function asObject(bodyText: string): AppPlatformObject {
  return parseJsonBody(bodyText) as AppPlatformObject;
}

/**
 * `metadata.resourceVersion`, as a string.
 *
 * Throws rather than defaulting: a resource whose revision could not be read
 * cannot participate in optimistic concurrency, and silently substituting
 * `""` or `"0"` would turn a precondition into a blind overwrite — the exact
 * class of bug the read-back/compare machinery exists to prevent.
 */
export function appPlatformRevision(object: AppPlatformObject): string {
  const raw = object.metadata?.resourceVersion;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number") return String(raw);
  throw new Error("App Platform response carried no metadata.resourceVersion");
}

export interface AppPlatformBehaviourOptions {
  readonly kind: GrafanaResourceKind;
  /** Canonical field names this kind compares on, read out of `spec`. */
  readonly canonicalFieldKeys: readonly string[];
  /** Builds the `spec` this kind sends for a create/update, from the caller's canonical input. */
  buildSpec(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  /** Extra `metadata.annotations` entries derived from the input — dashboards use this for folder placement. */
  buildAnnotations?(
    input: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, string>> | undefined;
  /** Reads back the annotation-borne canonical fields, so read-back compares against the same shape it wrote. */
  fieldsFromAnnotations?(
    annotations: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>>;
}

/**
 * Builds one kind's App Platform behaviour.
 *
 * Shared rather than hand-written per kind because the envelope is identical
 * across kinds — only the `spec` and the canonical-field projection differ.
 * Every kind that gets one of these must have had its shapes confirmed
 * against a live server first; see this module's header.
 */
export function appPlatformBehaviour(
  options: AppPlatformBehaviourOptions,
): Omit<GrafanaFamilyBehaviour, "canonicalizeDesiredInput"> {
  function metadataFor(
    name: string,
    input: Readonly<Record<string, unknown>>,
    resourceVersion?: string,
  ): Readonly<Record<string, unknown>> {
    const annotations = options.buildAnnotations?.(input);
    return {
      name,
      ...(resourceVersion !== undefined ? { resourceVersion } : {}),
      ...(annotations !== undefined && Object.keys(annotations).length > 0 ? { annotations } : {}),
    };
  }

  return {
    buildListRequest: (basePath) => ({ method: "GET", path: basePath }),

    buildGetRequest: (basePath, externalId) => ({
      method: "GET",
      path: `${basePath}/${encodeURIComponent(externalId)}`,
    }),

    // The caller-chosen `name` is the external id, exactly as the classic
    // API's `uid` is — so a replayed create addresses the same object and
    // Grafana's own `409 AlreadyExists` is what makes it idempotent.
    buildCreateRequest: (basePath, input, deterministicUid) => ({
      method: "POST",
      path: basePath,
      body: { metadata: metadataFor(deterministicUid, input), spec: options.buildSpec(input) },
    }),

    // PUT, not POST: the App Platform addresses an existing object by name.
    // `resourceVersion` is the precondition — Grafana returns 409 Conflict
    // when it is stale, which is what `hasPrecondition` promises the
    // mutation pipeline.
    buildUpdateRequest: (basePath, externalId, input, expectedRevision) => ({
      method: "PUT",
      path: `${basePath}/${encodeURIComponent(externalId)}`,
      body: {
        metadata: metadataFor(externalId, input, expectedRevision),
        spec: options.buildSpec(input),
      },
      hasPrecondition: true,
    }),

    // A list is `{items: [...]}`, never a bare array — the classic parsers'
    // `JSON.parse` + `Array.isArray` check would reject this outright.
    parseList: (bodyText): readonly GrafanaResourceSummary[] => {
      const items = asObject(bodyText.length > 0 ? bodyText : "{}").items ?? [];
      return items.map((entry) => {
        const object = entry as AppPlatformObject;
        const title = object.spec?.["title"];
        return {
          externalId: String(object.metadata?.name ?? ""),
          ...(typeof title === "string" ? { title } : {}),
        };
      });
    },

    // The create/update reply already carries the new revision; taking it
    // from there is what makes `appliedRevision` a real, server-assigned
    // value rather than the classic extractor's `"unknown"` fallback.
    revisionFromMutationResponse: (bodyText) => appPlatformRevision(asObject(bodyText)),

    parseCanonical: (externalId, bodyText): GrafanaParsedResource => {
      const object = asObject(bodyText);
      const annotations = object.metadata?.annotations ?? {};
      return {
        kind: options.kind,
        externalId,
        revision: appPlatformRevision(object),
        fields: pickCanonicalFields(
          { ...(object.spec ?? {}), ...(options.fieldsFromAnnotations?.(annotations) ?? {}) },
          options.canonicalFieldKeys,
        ),
      };
    },
  };
}

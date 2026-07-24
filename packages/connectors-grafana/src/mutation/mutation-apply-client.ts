import type { MutationApplyClient, MutationApplyResult } from "@eo/gateway";
import type { RemoteMutationPlan } from "@eo/contracts";
import type { RouteTable } from "../discovery/route-table.js";
import { getResourceDefinition } from "../resources/definitions/index.js";
import {
  canonicalFieldsEqual,
  hashCanonicalFields,
  type GrafanaResourceDefinition,
} from "../resources/resource-definitions.js";
import { toGatewayHttpRequest } from "../resources/transport-bridge.js";
import { revisionFromEtagOrField, parseJsonBody } from "../resources/definitions/shared.js";
import {
  createGrafanaMarkerReconciler,
  deriveAnnotationMarkerTag,
} from "../reconciliation/marker-reconciler.js";
import { parseCanonicalTarget } from "./canonical-target.js";
import type { GrafanaPlanPayloadStore } from "./plan-payload-store.js";
import type { GrafanaRollbackSnapshotStore } from "./snapshot-store.js";

export interface GrafanaRawHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

export interface GrafanaMutationApplyClientDeps {
  readonly baseUrl: string;
  readonly routeTable: RouteTable;
  readonly payloadStore: GrafanaPlanPayloadStore;
  readonly snapshotStore: GrafanaRollbackSnapshotStore;
  /** A non-mutating GET-only sender, for `verify`/`reconcileAmbiguous`'s own read-back and marker-search calls — the caller wires this from the SAME connection-scoped `GatewayHttpClient` `buildRequest` uses, so every call (mutating or not) shares one SSRF-guarded transport. */
  readonly get: (path: string) => Promise<GrafanaRawHttpResponse>;
  /** `annotation` creates only: searches by tag for the plan's derived marker (`../reconciliation/marker-reconciler.js`) — annotations accept no caller-supplied id, so uid-based lookup doesn't apply to this one kind. */
  readonly findAnnotationByTag?: (tag: string) => Promise<string | undefined>;
}

function requireBasePath(
  routeTable: RouteTable,
  kind: ReturnType<typeof parseCanonicalTarget>["kind"],
): string {
  const entry = routeTable[kind];
  if (entry === undefined) {
    throw new Error(`no route available for Grafana resource kind "${kind}" on this connection`);
  }
  return entry.basePath;
}

/** Resolves the plan's real remote externalId. Uid-addressable kinds set their uid explicitly at creation (`../resources/definitions/*.ts`'s `buildCreateRequest`), so `canonicalTarget`'s own id portion IS the real externalId in every case except an `annotation` create (annotations accept no caller-supplied id — the marker lives in `tags` instead). */
async function resolveExternalId(
  definition: GrafanaResourceDefinition,
  plan: RemoteMutationPlan,
  canonicalId: string,
  deps: GrafanaMutationApplyClientDeps,
): Promise<string | undefined> {
  if (definition.kind !== "annotation" || plan.action !== "create") {
    return canonicalId;
  }
  const reconciler = createGrafanaMarkerReconciler({
    kind: "annotation",
    ...(deps.findAnnotationByTag !== undefined ? { findByTag: deps.findAnnotationByTag } : {}),
  });
  return reconciler.findByMarker(deriveAnnotationMarkerTag(plan.idempotencyKey));
}

/**
 * Builds the Grafana `MutationApplyClient` (`@eo/gateway`'s
 * provider-dispatch contract for `observability.apply`) — one instance
 * handles all 7 resource kinds, dispatching on `plan.canonicalTarget`'s
 * `"<kind>:<id>"` prefix (`./canonical-target.js`).
 */
export function createGrafanaMutationApplyClient(
  deps: GrafanaMutationApplyClientDeps,
): MutationApplyClient {
  return {
    buildRequest(plan) {
      const { kind, id } = parseCanonicalTarget(plan.canonicalTarget);
      const definition = getResourceDefinition(kind);
      const basePath = requireBasePath(deps.routeTable, kind);
      const payload = deps.payloadStore.get(plan.id);
      if (payload === undefined) {
        throw new Error(
          `no stored plan payload for plan ${plan.id} — planCreate/planUpdate must run first`,
        );
      }

      if (plan.action === "create") {
        const spec = definition.buildCreateRequest(basePath, payload.input, id);
        return toGatewayHttpRequest(spec, deps.baseUrl);
      }
      if (plan.action === "update") {
        if (plan.expectedRemoteRevision === undefined) {
          throw new Error(`update plan ${plan.id} is missing expectedRemoteRevision`);
        }
        const spec = definition.buildUpdateRequest(
          basePath,
          id,
          payload.input,
          plan.expectedRemoteRevision,
        );
        return toGatewayHttpRequest(spec, deps.baseUrl);
      }
      throw new Error(`GrafanaMutationApplyClient: unsupported action "${plan.action}"`);
    },

    parseResponse(_plan, response): MutationApplyResult {
      const raw = parseJsonBody(response.bodyText);
      return {
        appliedRevision: revisionFromEtagOrField(
          response.headers,
          raw.version as string | number | undefined,
        ),
      };
    },

    async verify(plan, _applied): Promise<boolean> {
      const { kind, id } = parseCanonicalTarget(plan.canonicalTarget);
      const definition = getResourceDefinition(kind);
      const basePath = requireBasePath(deps.routeTable, kind);
      const payload = deps.payloadStore.get(plan.id);
      if (payload === undefined) return false;
      // buildRequest already refused any action other than create/update
      // for this plan (it would have thrown before a network call was
      // ever issued) — this is a defensive fallback, never reachable in
      // practice.
      if (plan.action !== "create" && plan.action !== "update") return false;

      const externalId = await resolveExternalId(definition, plan, id, deps);
      if (externalId === undefined) return false;

      const getSpec = definition.buildGetRequest(basePath, externalId);
      const response = await deps.get(getSpec.path);
      if (response.status >= 400) return false;

      const canonical = definition.parseCanonical(externalId, response.bodyText, response.headers);
      // Adversarial-review HIGH fix: compare against the CONNECTOR'S
      // actual desired state (`canonicalizeDesiredInput` — annotation's
      // injected marker tag, contact-point/notification-template's
      // redacted secrets), never the raw caller-supplied `payload.input`
      // directly. Comparing against the raw input made every annotation
      // create's read-back mismatch (the real remote object legitimately
      // carries the marker tag the raw input never had), so 16's pipeline
      // recorded every successful annotation write as `failed`.
      const desiredFields = definition.canonicalizeDesiredInput(payload.input, {
        action: plan.action,
        deterministicUid: id,
      });
      return hashCanonicalFields(canonical.fields) === hashCanonicalFields(desiredFields);
    },

    async reconcileAmbiguous(plan, _cause): Promise<MutationApplyResult | undefined> {
      const { kind, id } = parseCanonicalTarget(plan.canonicalTarget);
      const definition = getResourceDefinition(kind);
      const basePath = requireBasePath(deps.routeTable, kind);
      const payload = deps.payloadStore.get(plan.id);
      if (payload === undefined) return undefined;

      if (plan.action === "create") {
        const externalId = await resolveExternalId(definition, plan, id, deps);
        if (externalId === undefined) return undefined; // genuinely not found — block, never guess
        const getSpec = definition.buildGetRequest(basePath, externalId);
        const response = await deps.get(getSpec.path);
        if (response.status >= 400) return undefined;
        const canonical = definition.parseCanonical(
          externalId,
          response.bodyText,
          response.headers,
        );
        return { appliedRevision: canonical.revision };
      }

      if (plan.action === "update") {
        // An ambiguous PUT: only reconcile if the remote ALREADY reflects
        // exactly our desired state (a true no-op-equivalent) — otherwise
        // this is genuinely unknown and must block, never guessed. Same
        // `canonicalizeDesiredInput` comparison baseline as `verify()`
        // (adversarial-review HIGH fix) — never the raw `payload.input`.
        const getSpec = definition.buildGetRequest(basePath, id);
        const response = await deps.get(getSpec.path);
        if (response.status >= 400) return undefined;
        const canonical = definition.parseCanonical(id, response.bodyText, response.headers);
        const desiredFields = definition.canonicalizeDesiredInput(payload.input, {
          action: "update",
          deterministicUid: id,
        });
        if (!canonicalFieldsEqual(canonical.fields, desiredFields)) return undefined;
        return { appliedRevision: canonical.revision };
      }

      return undefined;
    },
  };
}

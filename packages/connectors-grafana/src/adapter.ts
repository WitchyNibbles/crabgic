import { randomUUID } from "node:crypto";
import type { CapabilitySnapshot, RemoteMutationPlan } from "@eo/contracts";
import { decodeApiFamiliesToRouteTable, type RouteTable } from "./discovery/route-table.js";
import { getResourceDefinition } from "./resources/definitions/index.js";
import type {
  GrafanaParsedResource,
  GrafanaResourceSummary,
} from "./resources/resource-definitions.js";
import type { GrafanaResourceKind } from "./resource-kinds.js";
import { assertWritableCapability } from "./mutation/write-eligibility-guard.js";
import { deriveDeterministicUid } from "./reconciliation/marker-reconciler.js";
import { buildGrafanaMutationPlan } from "./mutation/mutation-plan-builder.js";
import { GrafanaPlanPayloadStore } from "./mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "./mutation/snapshot-store.js";
import type { GrafanaRawHttpResponse } from "./mutation/mutation-apply-client.js";

/**
 * `GrafanaProviderAdapter` — roadmap/20-grafana-adapters.md §Interfaces
 * produced, verbatim: "the resource-client/discovery/serializer bundle this
 * phase registers into 16's provider-dispatch point for the
 * `observability.*` tool family... Exposes list/get/create/update per
 * resource kind... no delete method exists on the type." This interface
 * is that exhaustive list, deliberately: adding a delete method here is a
 * type-level impossibility, not merely an unused capability
 * (`./security/no-delete-admin.test.ts` proves it at the object-shape
 * level too).
 */
export interface GrafanaProviderAdapter {
  list(kind: GrafanaResourceKind): Promise<readonly GrafanaResourceSummary[]>;
  get(kind: GrafanaResourceKind, externalId: string): Promise<GrafanaParsedResource>;
  /** Builds (never applies) a create `RemoteMutationPlan` — planning is local-only; no network call other than the capability-snapshot lookup itself. Refuses (throws) before doing anything at all when the connection's current snapshot is read-only. */
  planCreate(
    kind: GrafanaResourceKind,
    input: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<RemoteMutationPlan>;
  /** Builds an update `RemoteMutationPlan` — captures the pre-mutation rollback snapshot AND the expected remote revision via one authoritative GET, both before any write is ever attempted. */
  planUpdate(
    kind: GrafanaResourceKind,
    externalId: string,
    input: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<RemoteMutationPlan>;
}

export interface GrafanaProviderAdapterDeps {
  readonly baseUrl: string;
  readonly externalConnectionId: string;
  readonly tenant: string;
  readonly envelopeId: string;
  readonly getSnapshot: () => Promise<CapabilitySnapshot>;
  readonly send: (spec: {
    readonly method: string;
    readonly path: string;
  }) => Promise<GrafanaRawHttpResponse>;
  readonly payloadStore: GrafanaPlanPayloadStore;
  readonly snapshotStore: GrafanaRollbackSnapshotStore;
  readonly generatePlanId?: () => string;
}

async function resolveRouteTable(deps: GrafanaProviderAdapterDeps): Promise<RouteTable> {
  const snapshot = await deps.getSnapshot();
  return decodeApiFamiliesToRouteTable(snapshot.apiFamilies);
}

function requireBasePath(routeTable: RouteTable, kind: GrafanaResourceKind): string {
  const entry = routeTable[kind];
  if (entry === undefined) {
    throw new Error(`no route available for Grafana resource kind "${kind}" on this connection`);
  }
  return entry.basePath;
}

/** Builds a `GrafanaProviderAdapter` — roadmap/20's resource-client/discovery/serializer bundle. */
export function createGrafanaProviderAdapter(
  deps: GrafanaProviderAdapterDeps,
): GrafanaProviderAdapter {
  const generatePlanId = deps.generatePlanId ?? randomUUID;

  return {
    async list(kind) {
      const routeTable = await resolveRouteTable(deps);
      const basePath = requireBasePath(routeTable, kind);
      const definition = getResourceDefinition(kind);
      const listSpec = definition.buildListRequest(basePath);
      const response = await deps.send(listSpec);
      return definition.parseList(response.bodyText);
    },

    async get(kind, externalId) {
      const routeTable = await resolveRouteTable(deps);
      const basePath = requireBasePath(routeTable, kind);
      const definition = getResourceDefinition(kind);
      const getSpec = definition.buildGetRequest(basePath, externalId);
      const response = await deps.send(getSpec);
      return definition.parseCanonical(externalId, response.bodyText, response.headers);
    },

    async planCreate(kind, input, idempotencyKey) {
      // Exit criterion: a mutation attempt against a read-only snapshot
      // fails BEFORE any HTTP call — this check runs before `resolveRouteTable`
      // even resolves a route, let alone issues a request.
      const snapshot = await deps.getSnapshot();
      assertWritableCapability(snapshot);
      const routeTable = decodeApiFamiliesToRouteTable(snapshot.apiFamilies);
      requireBasePath(routeTable, kind); // fail fast if this build doesn't support the kind at all

      const deterministicUid = deriveDeterministicUid(idempotencyKey);
      const planId = generatePlanId();
      const plan = buildGrafanaMutationPlan({
        id: planId,
        externalConnectionId: deps.externalConnectionId,
        tenant: deps.tenant,
        kind,
        action: "create",
        canonicalId: deterministicUid,
        input,
        idempotencyKey,
        envelopeId: deps.envelopeId,
        redactedDiff: `${kind}: (new) -> created`,
      });
      deps.payloadStore.set(planId, { kind, action: "create", input });
      return plan;
    },

    async planUpdate(kind, externalId, input, idempotencyKey) {
      const snapshot = await deps.getSnapshot();
      assertWritableCapability(snapshot);
      const routeTable = decodeApiFamiliesToRouteTable(snapshot.apiFamilies);
      const basePath = requireBasePath(routeTable, kind);
      const definition = getResourceDefinition(kind);

      // Capture the rollback snapshot + expected remote revision from ONE
      // authoritative GET, before any write is attempted (roadmap/20 §In
      // scope: "capture ... a rollback snapshot before every update").
      const getResponse = await deps.send(definition.buildGetRequest(basePath, externalId));
      const current = definition.parseCanonical(
        externalId,
        getResponse.bodyText,
        getResponse.headers,
      );

      const planId = generatePlanId();
      deps.snapshotStore.capture(planId, current);

      const plan = buildGrafanaMutationPlan({
        id: planId,
        externalConnectionId: deps.externalConnectionId,
        tenant: deps.tenant,
        kind,
        action: "update",
        canonicalId: externalId,
        input,
        idempotencyKey,
        expectedRemoteRevision: current.revision,
        envelopeId: deps.envelopeId,
        redactedDiff: `${kind}: updating ${externalId}`,
      });
      deps.payloadStore.set(planId, { kind, action: "update", input });
      return plan;
    },
  };
}

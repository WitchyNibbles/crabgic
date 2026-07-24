import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "@eo/gateway";
import { CapabilitySnapshotSchema, CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import { createGrafanaProviderAdapter } from "./adapter.js";
import { GrafanaPlanPayloadStore } from "./mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "./mutation/snapshot-store.js";
import { createGrafanaMutationApplyClient } from "./mutation/mutation-apply-client.js";
import {
  buildRouteTable,
  capabilityFlag,
  encodeRouteTableToApiFamilies,
} from "./discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "./resource-kinds.js";
import {
  GRAFANA_PROVIDER_NAME,
  buildGrafanaGenericProviderClient,
  registerGrafanaProvider,
} from "./provider-registration.js";

const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);

function buildTestAdapter() {
  const payloadStore = new GrafanaPlanPayloadStore();
  const snapshotStore = new GrafanaRollbackSnapshotStore();
  const send = async () => ({
    status: 200,
    headers: {},
    bodyText: JSON.stringify([{ uid: "fold-1", title: "Team" }]),
  });
  const adapter = createGrafanaProviderAdapter({
    baseUrl: "https://fake-grafana.invalid",
    externalConnectionId: "00000000-0000-4000-8000-000000000701",
    tenant: "tenant-1",
    envelopeId: "00000000-0000-4000-8000-000000000702",
    getSnapshot: async () =>
      CapabilitySnapshotSchema.parse({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "00000000-0000-4000-8000-000000000703",
        externalConnectionId: "00000000-0000-4000-8000-000000000701",
        product: "grafana",
        edition: "oss",
        version: "13.1.0",
        apiFamilies: encodeRouteTableToApiFamilies(FULL_ROUTE_TABLE),
        resources: [...GRAFANA_RESOURCE_KINDS],
        actions: ["list", "get", "create", "update"],
        permissions: ["read", "write"],
        isReadOnly: false,
        discoveredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }),
    send,
    payloadStore,
    snapshotStore,
  });
  return { adapter, payloadStore, snapshotStore };
}

describe("buildGrafanaGenericProviderClient — validated boundary", () => {
  it("search() validates resourceKind and dispatches to adapter.list", async () => {
    const { adapter } = buildTestAdapter();
    const client = buildGrafanaGenericProviderClient(adapter);
    const result = await client.search!({ resourceKind: "folder" });
    expect(result).toEqual([{ externalId: "fold-1", title: "Team" }]);
  });

  it("search() rejects a malformed resourceKind before ever calling the adapter", async () => {
    const { adapter } = buildTestAdapter();
    const client = buildGrafanaGenericProviderClient(adapter);
    await expect(client.search!({ resourceKind: "data-source" })).rejects.toThrow();
  });

  it("get() validates resourceKind + externalId", async () => {
    const { adapter } = buildTestAdapter();
    const client = buildGrafanaGenericProviderClient(adapter);
    await expect(client.get!({ resourceKind: "folder" })).rejects.toThrow(); // missing externalId
  });

  it("query() runs the query-layer pipeline (time-range required, budgets enforced)", async () => {
    const { adapter } = buildTestAdapter();
    const client = buildGrafanaGenericProviderClient(adapter);
    await expect(client.query!({ rawRows: [] })).rejects.toThrow(); // missing required timeRange... actually optional at schema level
    const result = await client.query!({
      timeRange: { from: "now-1h", to: "now" },
      rawRows: [{ service: "checkout" }],
    });
    expect(result).toEqual([{ service: "checkout" }]);
  });

  it("get() validates and dispatches to adapter.get for a well-formed call", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const adapter = createGrafanaProviderAdapter({
      baseUrl: "https://fake-grafana.invalid",
      externalConnectionId: "00000000-0000-4000-8000-000000000704",
      tenant: "tenant-1",
      envelopeId: "00000000-0000-4000-8000-000000000705",
      getSnapshot: async () =>
        CapabilitySnapshotSchema.parse({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          id: "00000000-0000-4000-8000-000000000706",
          externalConnectionId: "00000000-0000-4000-8000-000000000704",
          product: "grafana",
          edition: "oss",
          version: "13.1.0",
          apiFamilies: encodeRouteTableToApiFamilies(FULL_ROUTE_TABLE),
          resources: [...GRAFANA_RESOURCE_KINDS],
          actions: ["list", "get", "create", "update"],
          permissions: ["read", "write"],
          isReadOnly: false,
          discoveredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      send: async () => ({
        status: 200,
        headers: { etag: '"etag-1"' },
        bodyText: JSON.stringify({ title: "Team", parentUid: null }),
      }),
      payloadStore,
      snapshotStore,
    });
    const client = buildGrafanaGenericProviderClient(adapter);
    const result = await client.get!({ resourceKind: "folder", externalId: "fold-1" });
    expect(result).toMatchObject({ revision: "etag-1" });
  });

  it("planCreate()/planUpdate() validate and dispatch to the adapter", async () => {
    const { adapter } = buildTestAdapter();
    const client = buildGrafanaGenericProviderClient(adapter);
    const created = await client.planCreate!({
      resourceKind: "folder",
      input: { title: "New" },
      idempotencyKey: "op-create-1",
    });
    expect((created as { action: string }).action).toBe("create");

    await expect(
      client.planUpdate!({
        resourceKind: "folder",
        input: { title: "New" },
        idempotencyKey: "op-update-1",
      }),
    ).rejects.toThrow(); // missing externalId
  });
});

describe("registerGrafanaProvider — registers both halves under the same provider key", () => {
  it("registers the GenericProviderClient and MutationApplyClient together", () => {
    const { adapter, payloadStore, snapshotStore } = buildTestAdapter();
    const providers = new ProviderRegistry<ReturnType<typeof buildGrafanaGenericProviderClient>>();
    const mutationApplyClients = new ProviderRegistry<
      ReturnType<typeof createGrafanaMutationApplyClient>
    >();
    const mutationApplyClient = createGrafanaMutationApplyClient({
      baseUrl: "https://fake-grafana.invalid",
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
    });

    registerGrafanaProvider({ providers, mutationApplyClients, adapter, mutationApplyClient });

    expect(providers.isRegistered(GRAFANA_PROVIDER_NAME)).toBe(true);
    expect(mutationApplyClients.isRegistered(GRAFANA_PROVIDER_NAME)).toBe(true);
    expect(providers.resolve(GRAFANA_PROVIDER_NAME)).toBeDefined();
    expect(mutationApplyClients.resolve(GRAFANA_PROVIDER_NAME)).toBe(mutationApplyClient);
  });
});

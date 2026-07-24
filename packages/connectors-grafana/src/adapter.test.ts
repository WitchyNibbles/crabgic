import { describe, expect, it } from "vitest";
import {
  CapabilitySnapshotSchema,
  CURRENT_SCHEMA_VERSION,
  type CapabilitySnapshot,
} from "@eo/contracts";
import { createGrafanaProviderAdapter } from "./adapter.js";
import {
  buildRouteTable,
  capabilityFlag,
  encodeRouteTableToApiFamilies,
} from "./discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "./resource-kinds.js";
import { GrafanaPlanPayloadStore } from "./mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "./mutation/snapshot-store.js";
import type { GrafanaRawHttpResponse } from "./mutation/mutation-apply-client.js";

const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);

function writableSnapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return CapabilitySnapshotSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "00000000-0000-4000-8000-000000000101",
    externalConnectionId: "00000000-0000-4000-8000-000000000102",
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
    ...overrides,
  });
}

function scriptedSend(responses: readonly GrafanaRawHttpResponse[]) {
  const calls: { method: string; path: string }[] = [];
  let index = 0;
  const send = async (spec: { method: string; path: string }): Promise<GrafanaRawHttpResponse> => {
    calls.push(spec);
    const response = responses[index];
    index += 1;
    if (response === undefined) throw new Error("scriptedSend: script exhausted");
    return response;
  };
  return { send, calls };
}

function buildAdapterDeps(overrides: {
  send: ReturnType<typeof scriptedSend>["send"];
  snapshot?: CapabilitySnapshot;
  payloadStore?: GrafanaPlanPayloadStore;
  snapshotStore?: GrafanaRollbackSnapshotStore;
}) {
  return {
    baseUrl: "https://fake-grafana.invalid",
    externalConnectionId: "00000000-0000-4000-8000-000000000102",
    tenant: "tenant-1",
    envelopeId: "00000000-0000-4000-8000-000000000103",
    getSnapshot: async () => overrides.snapshot ?? writableSnapshot(),
    send: overrides.send,
    payloadStore: overrides.payloadStore ?? new GrafanaPlanPayloadStore(),
    snapshotStore: overrides.snapshotStore ?? new GrafanaRollbackSnapshotStore(),
    generatePlanId: () => "00000000-0000-4000-8000-000000000199",
  };
}

describe("GrafanaProviderAdapter — list/get", () => {
  it("list() dispatches a GET and parses the summary list", async () => {
    const { send } = scriptedSend([
      { status: 200, headers: {}, bodyText: JSON.stringify([{ uid: "fold-1", title: "Team" }]) },
    ]);
    const adapter = createGrafanaProviderAdapter(buildAdapterDeps({ send }));
    const summaries = await adapter.list("folder");
    expect(summaries).toEqual([{ externalId: "fold-1", title: "Team" }]);
  });

  it("get() dispatches a GET and parses the canonical resource", async () => {
    const { send } = scriptedSend([
      {
        status: 200,
        headers: { etag: '"etag-1"' },
        bodyText: JSON.stringify({ title: "Team", parentUid: null }),
      },
    ]);
    const adapter = createGrafanaProviderAdapter(buildAdapterDeps({ send }));
    const resource = await adapter.get("folder", "fold-1");
    expect(resource.revision).toBe("etag-1");
    expect(resource.fields.title).toBe("Team");
  });
});

describe("GrafanaProviderAdapter — planCreate/planUpdate", () => {
  it("planCreate builds a plan without issuing any HTTP call for the plan itself", async () => {
    const { send, calls } = scriptedSend([]);
    const payloadStore = new GrafanaPlanPayloadStore();
    const adapter = createGrafanaProviderAdapter(buildAdapterDeps({ send, payloadStore }));
    const plan = await adapter.planCreate(
      "folder",
      { title: "New Folder", parentUid: null },
      "op-1",
    );
    expect(plan.action).toBe("create");
    expect(calls).toHaveLength(0);
    expect(payloadStore.get(plan.id)?.input).toEqual({ title: "New Folder", parentUid: null });
  });

  it("planUpdate captures a rollback snapshot + expectedRemoteRevision from ONE authoritative GET before any write", async () => {
    const { send, calls } = scriptedSend([
      {
        status: 200,
        headers: { etag: '"etag-1"' },
        bodyText: JSON.stringify({ title: "Old Title", parentUid: null }),
      },
    ]);
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const adapter = createGrafanaProviderAdapter(
      buildAdapterDeps({ send, payloadStore, snapshotStore }),
    );
    const plan = await adapter.planUpdate(
      "folder",
      "fold-1",
      { title: "New Title", parentUid: null },
      "op-2",
    );

    expect(plan.expectedRemoteRevision).toBe("etag-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    const snapshot = snapshotStore.get(plan.id);
    expect(snapshot?.fields).toEqual({ title: "Old Title", parentUid: null });
  });

  it("a contact-point create plan carries the required HighImpactCapabilityFlag", async () => {
    const { send } = scriptedSend([]);
    const adapter = createGrafanaProviderAdapter(buildAdapterDeps({ send }));
    const plan = await adapter.planCreate(
      "contact-point",
      { name: "on-call", type: "email" },
      "op-3",
    );
    expect(plan.requiredCapabilityFlags).toEqual(["contact points"]);
  });
});

describe("GrafanaProviderAdapter — exit criterion: unknown-build read-only snapshot fails a mutation attempt before any HTTP call", () => {
  it("planCreate refuses before ANY HTTP call when the snapshot is read-only", async () => {
    const { send, calls } = scriptedSend([]);
    const readOnlySnapshot = writableSnapshot({ isReadOnly: true, version: "9.0.7" });
    const adapter = createGrafanaProviderAdapter(
      buildAdapterDeps({ send, snapshot: readOnlySnapshot }),
    );

    await expect(adapter.planCreate("folder", { title: "x" }, "op-4")).rejects.toThrow(/read-only/);
    expect(calls).toHaveLength(0);
  });

  it("planUpdate refuses before ANY HTTP call when the snapshot is read-only (no read-back GET is even attempted)", async () => {
    const { send, calls } = scriptedSend([]);
    const readOnlySnapshot = writableSnapshot({ isReadOnly: true, version: "9.0.7" });
    const adapter = createGrafanaProviderAdapter(
      buildAdapterDeps({ send, snapshot: readOnlySnapshot }),
    );

    await expect(adapter.planUpdate("folder", "fold-1", { title: "x" }, "op-5")).rejects.toThrow(
      /read-only/,
    );
    expect(calls).toHaveLength(0);
  });

  it("list()/get() (reads) still work against a read-only snapshot — only writes are refused", async () => {
    const { send } = scriptedSend([{ status: 200, headers: {}, bodyText: "[]" }]);
    const readOnlySnapshot = writableSnapshot({ isReadOnly: true, version: "9.0.7" });
    const adapter = createGrafanaProviderAdapter(
      buildAdapterDeps({ send, snapshot: readOnlySnapshot }),
    );
    await expect(adapter.list("folder")).resolves.toEqual([]);
  });
});

describe("GrafanaProviderAdapter — a kind unsupported by this connection's discovered route table is refused", () => {
  it("list() throws before any HTTP call when the snapshot's route table has no entry for the requested kind", async () => {
    const { send, calls } = scriptedSend([]);
    const noRoutesSnapshot = writableSnapshot({ apiFamilies: [] }); // empty route table — nothing supported
    const adapter = createGrafanaProviderAdapter(
      buildAdapterDeps({ send, snapshot: noRoutesSnapshot }),
    );
    await expect(adapter.list("folder")).rejects.toThrow(/no route available/);
    expect(calls).toHaveLength(0);
  });

  it("planCreate throws before any HTTP call for an unsupported kind", async () => {
    const { send, calls } = scriptedSend([]);
    const noRoutesSnapshot = writableSnapshot({ apiFamilies: [] });
    const adapter = createGrafanaProviderAdapter(
      buildAdapterDeps({ send, snapshot: noRoutesSnapshot }),
    );
    await expect(adapter.planCreate("folder", { title: "x" }, "op-6")).rejects.toThrow(
      /no route available/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("GrafanaProviderAdapter — type-level: no delete method exists on the interface (roadmap/20 §Interfaces produced)", () => {
  it("the built adapter object carries no delete-shaped property at runtime either", async () => {
    const { send } = scriptedSend([]);
    const adapter = createGrafanaProviderAdapter(buildAdapterDeps({ send }));
    expect((adapter as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).remove).toBeUndefined();
    expect(Object.keys(adapter).sort()).toEqual(["get", "list", "planCreate", "planUpdate"].sort());
  });
});

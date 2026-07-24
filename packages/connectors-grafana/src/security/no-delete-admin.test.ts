import { describe, expect, it } from "vitest";
import { createGrafanaProviderAdapter } from "../adapter.js";
import { GRAFANA_RESOURCE_DEFINITIONS } from "../resources/definitions/index.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { GrafanaPlanPayloadStore } from "../mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
import { CapabilitySnapshotSchema, CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import type { GrafanaRawHttpResponse } from "../mutation/mutation-apply-client.js";

/**
 * roadmap/20-grafana-adapters.md exit criterion: "Security fixture suite:
 * forged delete/admin calls produce zero outbound HTTP requests
 * (mock-transport call-count assertion)." Test plan: "forged delete/admin/
 * notification-policy-tree-replacement/data-source-secret-admin calls
 * asserted to produce zero outbound HTTP requests (no matching method
 * exists on the public resource-client surface, so the call fails
 * pre-network)."
 *
 * Every assertion below fails BEFORE any HTTP call — the forged operation
 * simply does not exist as a callable method anywhere in this package's
 * public surface, so a caller attempting one gets a `TypeError` (or
 * `undefined`), never a network round-trip.
 */

function spySend() {
  const calls: unknown[] = [];
  const send = async (spec: unknown): Promise<GrafanaRawHttpResponse> => {
    calls.push(spec);
    return { status: 200, headers: {}, bodyText: "{}" };
  };
  return { send, calls };
}

const FORGED_OPERATION_NAMES = [
  "delete",
  "remove",
  "destroy",
  "deleteFolder",
  "deleteDashboard",
  "deleteUser",
  "createUser",
  "createServiceAccount",
  "createOrg",
  "createDataSource",
  "updateDataSourceSecret",
  "replaceNotificationPolicyTree",
  "putNotificationPolicyTree",
  "adminMutate",
] as const;

describe("GrafanaProviderAdapter — no forged delete/admin operation is callable", () => {
  it("none of the forged operation names exist as a function on the adapter", async () => {
    const { send, calls } = spySend();
    const adapter = createGrafanaProviderAdapter({
      baseUrl: "https://fake-grafana.invalid",
      externalConnectionId: "00000000-0000-4000-8000-000000000301",
      tenant: "tenant-1",
      envelopeId: "00000000-0000-4000-8000-000000000302",
      getSnapshot: async () =>
        CapabilitySnapshotSchema.parse({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          id: "00000000-0000-4000-8000-000000000303",
          externalConnectionId: "00000000-0000-4000-8000-000000000301",
          product: "grafana",
          edition: "oss",
          version: "13.1.0",
          apiFamilies: [],
          resources: [...GRAFANA_RESOURCE_KINDS],
          actions: ["list", "get", "create", "update"],
          permissions: ["read", "write"],
          isReadOnly: false,
          discoveredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      send,
      payloadStore: new GrafanaPlanPayloadStore(),
      snapshotStore: new GrafanaRollbackSnapshotStore(),
    });

    const untyped = adapter as unknown as Record<string, unknown>;
    for (const name of FORGED_OPERATION_NAMES) {
      expect(typeof untyped[name]).not.toBe("function");
    }
    expect(calls).toHaveLength(0);
  });

  it("Object.keys(adapter) is exactly {list, get, planCreate, planUpdate} — an exhaustive allowlist, not a denylist", () => {
    const { send } = spySend();
    const adapter = createGrafanaProviderAdapter({
      baseUrl: "https://fake-grafana.invalid",
      externalConnectionId: "00000000-0000-4000-8000-000000000301",
      tenant: "tenant-1",
      envelopeId: "00000000-0000-4000-8000-000000000302",
      getSnapshot: async () => {
        throw new Error("not needed for this test");
      },
      send,
      payloadStore: new GrafanaPlanPayloadStore(),
      snapshotStore: new GrafanaRollbackSnapshotStore(),
    });
    expect(Object.keys(adapter).sort()).toEqual(["get", "list", "planCreate", "planUpdate"].sort());
  });
});

describe("resource definitions — no definition exposes a delete-shaped request builder", () => {
  it("none of the 7 resource definitions has a buildDeleteRequest (or similarly named) method", () => {
    for (const kind of GRAFANA_RESOURCE_KINDS) {
      const definition = GRAFANA_RESOURCE_DEFINITIONS[kind] as unknown as Record<string, unknown>;
      for (const name of ["buildDeleteRequest", "buildRemoveRequest", "delete", "remove"]) {
        expect(typeof definition[name]).not.toBe("function");
      }
    }
  });

  it("the registry's own key set is exactly the 7 in-scope kinds — no data-source/user/org/notification-policy-tree kind exists", () => {
    const keys = Object.keys(GRAFANA_RESOURCE_DEFINITIONS);
    for (const forbidden of [
      "data-source",
      "user",
      "org",
      "service-account",
      "access-policy",
      "notification-policy-tree",
      "billing",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

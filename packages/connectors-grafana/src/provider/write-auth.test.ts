import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@crabgic/contracts";
import {
  ProviderRegistry,
  type GenericProviderClient,
  type MutationApplyClient,
} from "@crabgic/gateway";
import { registerRoutedGrafanaProvider } from "./register-grafana-routed.js";

const CONNECTION: ExternalConnection = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  provider: "grafana",
  baseUrl: "https://grafana.example.com",
  allowedRedirectOrigins: [],
  allowedResources: ["folder"],
  allowedActions: ["create"],
  discoveryTtlSeconds: 900,
  secretRef: { backend: "env", variable: "CRABGIC_GRAFANA_WRITE_AUTH" },
};

const PLAN = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "f1111111-1111-4111-8111-111111111111",
  externalConnectionId: CONNECTION.id,
  tenant: "t",
  canonicalTarget: "folder:fold-1",
  action: "create",
  redactedDiff: "title",
  desiredStateHash: "sha256:x",
  idempotencyKey: "k",
  impactClass: "reversible",
  rollbackClass: "version-checked-restore",
  envelopeId: "f2222222-2222-4222-8222-222222222222",
} as const;

const SNAPSHOT = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "f3333333-3333-4333-8333-333333333333",
  externalConnectionId: CONNECTION.id,
  product: "grafana",
  edition: "oss",
  version: "11.3.0",
  apiFamilies: ["folder:legacy"],
  resources: ["folder"],
  actions: ["create"],
  permissions: ["write"],
  isReadOnly: false,
  discoveredAt: "2026-08-15T00:00:00.000Z",
  expiresAt: "2026-08-15T00:15:00.000Z",
} as const;

/**
 * Issue #135, defect 5, Grafana half. The apply path builds a request that
 * the GATEWAY sends, so it never passed through this connector's own
 * authenticated sender — every Grafana write left the process bare.
 */
describe("registerRoutedGrafanaProvider — writes carry the connection's credential", () => {
  async function applyClient(): Promise<MutationApplyClient> {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerRoutedGrafanaProvider({ providers, mutationApplyClients });
    await registry.register(CONNECTION, {
      tenant: CONNECTION.id,
      getSnapshot: async () => SNAPSHOT,
      send: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
      get: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
      payloadStore: { get: () => undefined, set: () => undefined, clear: () => undefined },
      snapshotStore: {
        get: () => undefined,
        capture: () => undefined,
        clear: () => undefined,
        size: 0,
      },
    });
    return mutationApplyClients.resolve("grafana");
  }

  it("exposes an authHeaders hook at all — its absence was the defect", async () => {
    expect((await applyClient()).authHeaders).toBeDefined();
  });

  it("emits the connection's own token as a Bearer credential", async () => {
    process.env.CRABGIC_GRAFANA_WRITE_AUTH = "glsa_write_token";
    try {
      const client = await applyClient();
      expect(await client.authHeaders!(PLAN)).toEqual({
        authorization: "Bearer glsa_write_token",
      });
    } finally {
      delete process.env.CRABGIC_GRAFANA_WRITE_AUTH;
    }
  });

  it("resolves the secret per write, so a rotated token reaches the next mutation", async () => {
    process.env.CRABGIC_GRAFANA_WRITE_AUTH = "first";
    try {
      const client = await applyClient();
      const before = await client.authHeaders!(PLAN);
      process.env.CRABGIC_GRAFANA_WRITE_AUTH = "second";
      expect(await client.authHeaders!(PLAN)).not.toEqual(before);
    } finally {
      delete process.env.CRABGIC_GRAFANA_WRITE_AUTH;
    }
  });

  it("rejects rather than sending a bare write when the secret is unresolvable", async () => {
    delete process.env.CRABGIC_GRAFANA_WRITE_AUTH;
    const client = await applyClient();
    await expect(client.authHeaders!(PLAN)).rejects.toThrow();
  });

  it("resolves against the plan's OWN connection", async () => {
    const client = await applyClient();
    await expect(
      client.authHeaders!({ ...PLAN, externalConnectionId: "not-registered" }),
    ).rejects.toThrow(/never registered/);
  });
});

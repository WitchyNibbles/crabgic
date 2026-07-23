import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection, type RemoteMutationPlan } from "@eo/contracts";
import { InMemoryExternalConnectionStore } from "../../connection-store/external-connection-store.js";
import { ProviderRegistry } from "../../provider-dispatch/provider-registry.js";
import { IdempotencyKeyLock } from "../../mutation-pipeline/mutation-pipeline.js";
import { GatewayHttpClient } from "../../transport/http-client.js";
import { buildMutationApplyTool, type MutationApplyToolDeps } from "./mutation-apply-tool.js";
import type { MutationApplyClient } from "./mutation-apply-client.js";

function buildPlan(connectionId: string, overrides: Partial<RemoteMutationPlan> = {}): RemoteMutationPlan {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "f0000000-0000-4000-8000-000000000001",
    externalConnectionId: connectionId,
    tenant: "tenant-a",
    canonicalTarget: "issue:EX-1",
    action: "transition",
    redactedDiff: "status: To Do -> In Progress",
    desiredStateHash: "sha256:mutation-apply-tool-test",
    idempotencyKey: "mutation-apply-tool-test-op",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: "f0000000-0000-4000-8000-000000000002",
    ...overrides,
  };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-gateway-mutation-apply-tool-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildDeps(overrides: Partial<MutationApplyToolDeps> = {}): MutationApplyToolDeps {
  return {
    connections: new InMemoryExternalConnectionStore(),
    mutationApplyClients: new ProviderRegistry<MutationApplyClient>(),
    journal,
    lock: new IdempotencyKeyLock(),
    ...overrides,
  };
}

describe("buildMutationApplyTool", () => {
  it("returns a not_found error for an unknown connectionId", async () => {
    const tool = buildMutationApplyTool("tracker.apply", "test", buildDeps());
    const result = await tool.handler({ plan: buildPlan("00000000-0000-4000-8000-000000000000") });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not_found");
  });

  it("returns an unsupported error for a connection whose provider has no registered MutationApplyClient", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "no-apply-client-provider",
      baseUrl: "https://example.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const tool = buildMutationApplyTool("tracker.apply", "test", buildDeps({ connections }));
    const result = await tool.handler({ plan: buildPlan(connection.id) });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unsupported");
  });

  it("uses the provider client's own verify() when supplied", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "verifying-provider",
      baseUrl: "https://verifying-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    let verifyCalled = false;
    mutationApplyClients.register("verifying-provider", {
      buildRequest: () => ({ url: new URL("https://verifying-provider.invalid/apply"), method: "PUT", hasPrecondition: true }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
      verify: async () => {
        verifyCalled = true;
        return true;
      },
    });

    const buildHttpClient = async (_c: ExternalConnection) =>
      new GatewayHttpClient({
        allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://verifying-provider.invalid"] },
        resolveHostAddresses: async () => ["203.0.113.7"],
        sendRequest: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
      });

    const tool = buildMutationApplyTool(
      "tracker.apply",
      "test",
      buildDeps({ connections, mutationApplyClients, buildHttpClient }),
    );
    const result = await tool.handler({ plan: buildPlan(connection.id) });
    expect(result.isError).toBeFalsy();
    expect(verifyCalled).toBe(true);
  });

  it("uses the provider client's own reconcileAmbiguous() when the network call fails", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "reconciling-provider",
      baseUrl: "https://reconciling-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    let reconcileCalled = false;
    mutationApplyClients.register("reconciling-provider", {
      buildRequest: () => ({ url: new URL("https://reconciling-provider.invalid/apply"), method: "PUT", hasPrecondition: true }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
      reconcileAmbiguous: async () => {
        reconcileCalled = true;
        return { appliedRevision: "reconciled-rev" };
      },
    });

    const buildHttpClient = async (_c: ExternalConnection) =>
      new GatewayHttpClient({
        allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://reconciling-provider.invalid"] },
        resolveHostAddresses: async () => ["203.0.113.7"],
        sendRequest: async () => {
          throw new Error("ECONNRESET");
        },
      });

    const tool = buildMutationApplyTool(
      "tracker.apply",
      "test",
      buildDeps({ connections, mutationApplyClients, buildHttpClient }),
    );
    const result = await tool.handler({ plan: buildPlan(connection.id) });
    expect(result.isError).toBeFalsy();
    expect(reconcileCalled).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      status: "recorded",
      appliedRevision: "reconciled-rev",
    });
  });
});

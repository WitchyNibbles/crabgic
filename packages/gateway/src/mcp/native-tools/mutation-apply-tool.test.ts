import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  CURRENT_SCHEMA_VERSION,
  type ExternalConnection,
  type RemoteMutationPlan,
} from "@crabgic/contracts";
import { InMemoryExternalConnectionStore } from "../../connection-store/external-connection-store.js";
import { ProviderRegistry } from "../../provider-dispatch/provider-registry.js";
import { IdempotencyKeyLock } from "../../mutation-pipeline/mutation-pipeline.js";
import { GatewayHttpClient } from "../../transport/http-client.js";
import { buildMutationApplyTool, type MutationApplyToolDeps } from "./mutation-apply-tool.js";
import type { MutationApplyClient } from "./mutation-apply-client.js";

function buildPlan(
  connectionId: string,
  overrides: Partial<RemoteMutationPlan> = {},
): RemoteMutationPlan {
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
      buildRequest: () => ({
        url: new URL("https://verifying-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
      verify: async () => {
        verifyCalled = true;
        return true;
      },
    });

    const buildHttpClient = async (_c: ExternalConnection) =>
      new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://verifying-provider.invalid"],
        },
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
      buildRequest: () => ({
        url: new URL("https://reconciling-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
      reconcileAmbiguous: async () => {
        reconcileCalled = true;
        return { appliedRevision: "reconciled-rev" };
      },
    });

    const buildHttpClient = async (_c: ExternalConnection) =>
      new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://reconciling-provider.invalid"],
        },
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

  /**
   * The PRODUCTION bridge from `MutationApplyClient` to
   * `MutationPipelineHandlers`. `packages/connectors-jira/src/testkit/
   * write-order.integration.test.ts` calls `executeMutationPlan` directly
   * and therefore does NOT cross this bridge — without the two cases
   * below, the `serializationTarget` forwarding line in
   * `./mutation-apply-tool.ts` could be deleted with every connector test
   * still green while production regressed.
   */
  it("forwards the provider client's serializationTarget to the transport's `resource` key", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "serializing-provider",
      baseUrl: "https://serializing-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    mutationApplyClients.register("serializing-provider", {
      buildRequest: () => ({
        url: new URL("https://serializing-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
      serializationTarget: (plan) => plan.canonicalTarget.split(":").slice(0, 2).join(":"),
    });

    let requestSpy: ReturnType<typeof vi.spyOn> | undefined;
    const buildHttpClient = async (_c: ExternalConnection) => {
      const client = new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://serializing-provider.invalid"],
        },
        resolveHostAddresses: async () => ["203.0.113.7"],
        sendRequest: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
      });
      requestSpy = vi.spyOn(client, "request");
      return client;
    };

    const tool = buildMutationApplyTool(
      "tracker.apply",
      "test",
      buildDeps({ connections, mutationApplyClients, buildHttpClient }),
    );
    const result = await tool.handler({
      plan: buildPlan(connection.id, { canonicalTarget: "issue:EX-1:comment" }),
    });

    expect(result.isError).toBeFalsy();
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect((requestSpy?.mock.calls[0]?.[0] as { resource: string }).resource).toBe("issue:EX-1");
  });

  /**
   * DEFECT 21 — `ExternalConnection.tenantAllowlist` was a published schema
   * field that looked like a security control and enforced nothing.
   *
   * These two cases are deliberately at the TOOL level, not the pipeline
   * level: this is the production wiring that has to hand the connection's
   * own field to `executeMutationPlan`. A pipeline-only test would pass
   * with the tool never reading the connection at all.
   *
   * SCOPE, stated here so a reader does not over-trust the assertion: this
   * binds the tenant a plan DECLARES, on the mutation path. It is not
   * "cross-tenant access is refused" — reads are not tenant-checked and the
   * remote's actual tenant identity is never verified. See
   * `packages/contracts/src/contracts/external-connection.ts`'s
   * `tenantAllowlist` doc comment.
   *
   * The bearer is the TRIPLE assertion — outcome status, the exact typed
   * `policy_blocked` kind, and ZERO transport calls. Asserting only on
   * `detail` would pass in both worlds (a `failed` detail from another
   * cause can contain the same words), and a bare "is an error" would pass
   * for any of the ten canonical kinds.
   */
  it("refuses a plan whose declared tenant is outside the connection's tenantAllowlist — typed policy_blocked, zero network calls", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "tenant-scoped-provider",
      baseUrl: "https://tenant-scoped-provider.invalid",
      allowedRedirectOrigins: [],
      tenantAllowlist: ["tenant-a"],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    mutationApplyClients.register("tenant-scoped-provider", {
      buildRequest: () => ({
        url: new URL("https://tenant-scoped-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
    });

    let transportCalls = 0;
    const buildHttpClient = async (_c: ExternalConnection) =>
      new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://tenant-scoped-provider.invalid"],
        },
        resolveHostAddresses: async () => ["203.0.113.7"],
        sendRequest: async () => {
          transportCalls += 1;
          return { status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' };
        },
      });

    const tool = buildMutationApplyTool(
      "tracker.apply",
      "test",
      buildDeps({ connections, mutationApplyClients, buildHttpClient }),
    );
    const result = await tool.handler({
      plan: buildPlan(connection.id, { tenant: "tenant-b" }),
    });

    const outcome = JSON.parse(result.content[0]?.text ?? "{}") as {
      status?: string;
      errorKind?: string;
    };
    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("policy_blocked");
    expect(transportCalls).toBe(0);
  });

  /**
   * CONTROL — green in BOTH worlds (before and after the fix). It rules out
   * a refuse-everything implementation, which the refusal case above would
   * accept on its own.
   */
  it("CONTROL: an in-allowlist declared tenant is still applied — recorded, exactly one network call", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "tenant-scoped-provider",
      baseUrl: "https://tenant-scoped-provider.invalid",
      allowedRedirectOrigins: [],
      tenantAllowlist: ["tenant-a"],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    mutationApplyClients.register("tenant-scoped-provider", {
      buildRequest: () => ({
        url: new URL("https://tenant-scoped-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
    });

    let transportCalls = 0;
    const buildHttpClient = async (_c: ExternalConnection) =>
      new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://tenant-scoped-provider.invalid"],
        },
        resolveHostAddresses: async () => ["203.0.113.7"],
        sendRequest: async () => {
          transportCalls += 1;
          return { status: 200, headers: {}, bodyText: '{"appliedRevision":"rev-1"}' };
        },
      });

    const tool = buildMutationApplyTool(
      "tracker.apply",
      "test",
      buildDeps({ connections, mutationApplyClients, buildHttpClient }),
    );
    const result = await tool.handler({
      plan: buildPlan(connection.id, { tenant: "tenant-a" }),
    });

    const outcome = JSON.parse(result.content[0]?.text ?? "{}") as { status?: string };
    expect(outcome.status).toBe("recorded");
    expect(transportCalls).toBe(1);
  });

  it("DEFAULT PATH: a provider client without serializationTarget still keys on canonicalTarget", async () => {
    const connections = new InMemoryExternalConnectionStore();
    const connection = await connections.create({
      provider: "plain-provider",
      baseUrl: "https://plain-provider.invalid",
      allowedRedirectOrigins: [],
      allowedResources: [],
      allowedActions: [],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env", variable: "X" },
    });
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const plainClient: MutationApplyClient = {
      buildRequest: () => ({
        url: new URL("https://plain-provider.invalid/apply"),
        method: "PUT",
        hasPrecondition: true,
      }),
      parseResponse: () => ({ appliedRevision: "rev-1" }),
    };
    expect(plainClient.serializationTarget).toBeUndefined();
    mutationApplyClients.register("plain-provider", plainClient);

    let requestSpy: ReturnType<typeof vi.spyOn> | undefined;
    const buildHttpClient = async (_c: ExternalConnection) => {
      const client = new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://plain-provider.invalid"],
        },
        resolveHostAddresses: async () => ["203.0.113.7"],
        sendRequest: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
      });
      requestSpy = vi.spyOn(client, "request");
      return client;
    };

    const tool = buildMutationApplyTool(
      "tracker.apply",
      "test",
      buildDeps({ connections, mutationApplyClients, buildHttpClient }),
    );
    const result = await tool.handler({
      plan: buildPlan(connection.id, { canonicalTarget: "dashboard:abc123" }),
    });

    expect(result.isError).toBeFalsy();
    expect((requestSpy?.mock.calls[0]?.[0] as { resource: string }).resource).toBe(
      "dashboard:abc123",
    );
  });
});

import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@crabgic/contracts";
import type { GatewayHttpClient, MutationApplyClient } from "@crabgic/gateway";
import { ProviderRegistry } from "@crabgic/gateway";
import type { GenericProviderClient } from "@crabgic/gateway";
import { JiraTokenManager } from "../auth/token-manager.js";
import { registerJiraCloudProvider } from "./register.js";

const CONNECTION: ExternalConnection = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  provider: "jira-cloud",
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: [],
  allowedResources: ["issue"],
  allowedActions: ["transition"],
  discoveryTtlSeconds: 900,
  secretRef: { backend: "env", variable: "TOKEN" },
};

const PLAN = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  externalConnectionId: CONNECTION.id,
  tenant: "t",
  canonicalTarget: "issue:EX-1",
  action: "transition",
  redactedDiff: "status",
  desiredStateHash: "sha256:x",
  idempotencyKey: "k",
  impactClass: "reversible",
  rollbackClass: "version-checked-restore",
  envelopeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
} as const;

const noopHttpClient = async (): Promise<GatewayHttpClient> =>
  ({ request: async () => ({ status: 200, headers: {}, bodyText: "{}" }) }) as never;

/**
 * Issue #135, defect 5. `MutationApplyClient.buildRequest` is synchronous,
 * so no connector could resolve a credential inside it — every Jira write
 * left the process carrying `content-type` and nothing else, while reads
 * authenticated correctly. `authHeaders` is the async hook that closes it,
 * and it routes through the SAME `jiraAuthHeader` the read path uses.
 */
describe("registerJiraCloudProvider — writes carry the connection's credential", () => {
  async function applyClientFor(
    options: Parameters<Awaited<ReturnType<typeof registerJiraCloudProvider>>["register"]>[2] = {},
    tokenManager?: JiraTokenManager,
  ): Promise<MutationApplyClient> {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerJiraCloudProvider({ providers, mutationApplyClients });
    await registry.register(CONNECTION, tokenManager, {
      buildHttpClient: noopHttpClient,
      ...options,
    });
    return mutationApplyClients.resolve("jira-cloud");
  }

  it("exposes an authHeaders hook at all — its absence was the defect", async () => {
    const client = await applyClientFor({
      authHeaderProvider: async () => ({ authorization: "Basic abc" }),
    });
    expect(client.authHeaders).toBeDefined();
  });

  it("emits the Basic scheme an API-token connection is configured with", async () => {
    const client = await applyClientFor({
      authHeaderProvider: async () => ({ authorization: "Basic abc" }),
    });
    expect(await client.authHeaders!(PLAN)).toEqual({ authorization: "Basic abc" });
  });

  it("emits the OAuth Bearer scheme for a connection configured that way", async () => {
    const client = await applyClientFor(
      {},
      new JiraTokenManager({
        fetchToken: async () => ({ accessToken: "oauth-tok", expiresInSeconds: 3600, scopes: [] }),
      }),
    );
    expect(await client.authHeaders!(PLAN)).toEqual({ authorization: "Bearer oauth-tok" });
  });

  it("refuses rather than returning an empty header set when nothing can authenticate", async () => {
    // An empty object would be indistinguishable from "no auth needed" and
    // would send the write bare — the exact pre-fix behaviour.
    const client = await applyClientFor({});
    await expect(client.authHeaders!(PLAN)).rejects.toThrow(/authenticate/);
  });

  it("resolves against the plan's OWN connection, not some ambient default", async () => {
    const client = await applyClientFor({
      authHeaderProvider: async () => ({ authorization: "Basic abc" }),
    });
    await expect(
      client.authHeaders!({ ...PLAN, externalConnectionId: "not-registered" }),
    ).rejects.toThrow(/never registered/);
  });
});

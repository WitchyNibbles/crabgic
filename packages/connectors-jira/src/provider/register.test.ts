import { describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  ProviderRegistry,
  createFakeProviderTransport,
  type GenericProviderClient,
  type MutationApplyClient,
} from "@eo/gateway";
import { RemoteMutationPlanSchema } from "@eo/contracts";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { JIRA_PROVIDER_NAME, registerJiraCloudProvider } from "./register.js";
import { JiraConnectionNotRegisteredError } from "./jira-connection-registry.js";

function buildTokenManager(): JiraTokenManager {
  return new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
}

describe("registerJiraCloudProvider", () => {
  it("registers under JIRA_PROVIDER_NAME in both the generic and mutation-apply provider registries", () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();

    registerJiraCloudProvider({ providers, mutationApplyClients });

    expect(providers.isRegistered(JIRA_PROVIDER_NAME)).toBe(true);
    expect(mutationApplyClients.isRegistered(JIRA_PROVIDER_NAME)).toBe(true);
  });

  it("routes a dispatch call to the correct registered connection's resource client", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerJiraCloudProvider({ providers, mutationApplyClients });

    const connection = buildExternalConnection({
      provider: "jira-cloud",
      baseUrl: "https://register-test.atlassian.invalid",
    });
    const fake = createFakeProviderTransport({
      responses: [{ status: 200, bodyText: JSON.stringify({ values: [] }) }],
    });
    await registry.register(connection, buildTokenManager(), {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: {
            allowedSchemes: ["https:"],
            allowedOrigins: [new URL(connection.baseUrl).origin],
          },
          resolveHostAddresses: async () => ["203.0.113.60"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
    });

    const client = providers.resolve(JIRA_PROVIDER_NAME);
    const result = await client.search?.({ connectionId: connection.id, resource: "project" });

    expect(result).toEqual([]);
  });

  it("a dispatch call for an unregistered connectionId throws JiraConnectionNotRegisteredError", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraCloudProvider({ providers, mutationApplyClients });

    const client = providers.resolve(JIRA_PROVIDER_NAME);
    await expect(
      client.search?.({ connectionId: "unregistered-id", resource: "project" }),
    ).rejects.toBeInstanceOf(JiraConnectionNotRegisteredError);
  });

  it("routes a mutation-apply buildRequest call by plan.externalConnectionId", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerJiraCloudProvider({ providers, mutationApplyClients });

    const connection = buildExternalConnection({
      provider: "jira-cloud",
      baseUrl: "https://register-apply-test.atlassian.invalid",
    });
    const fake = createFakeProviderTransport({ responses: [] });
    await registry.register(connection, buildTokenManager(), {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: {
            allowedSchemes: ["https:"],
            allowedOrigins: [new URL(connection.baseUrl).origin],
          },
          resolveHostAddresses: async () => ["203.0.113.61"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
    });

    const plan = RemoteMutationPlanSchema.parse({
      schemaVersion: 1,
      id: "66666666-6666-4666-8666-666666666666",
      externalConnectionId: connection.id,
      tenant: "t",
      canonicalTarget: "issue:PROJ-1",
      action: "issue.update",
      redactedDiff: "d",
      desiredStateHash: "sha256:x",
      idempotencyKey: "op-1",
      impactClass: "reversible",
      rollbackClass: "version-checked-restore",
      envelopeId: "77777777-7777-4777-8777-777777777777",
    });
    registry.get(connection.id).applyDeps.payloadRegistry.put(plan.id, { summary: "x" });

    const applyClient = mutationApplyClients.resolve(JIRA_PROVIDER_NAME);
    const spec = applyClient.buildRequest(plan);

    expect(spec.url.pathname).toBe("/rest/api/3/issue/PROJ-1");

    // parseResponse / verify / reconcileAmbiguous all route the same way.
    const parsed = applyClient.parseResponse(plan, { status: 204, headers: {}, bodyText: "" });
    expect(parsed.appliedRevision).toBe(plan.desiredStateHash);

    const verified = await applyClient.verify?.(plan, { appliedRevision: "x" });
    expect(typeof verified).toBe("boolean");

    const reconciled = await applyClient.reconcileAmbiguous?.(plan, new Error("timeout"));
    expect(reconciled).toBeUndefined();
  });

  it("get/planCreate/planUpdate/planTransition/planComment all route through the same registered connection", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerJiraCloudProvider({ providers, mutationApplyClients });

    const connection = buildExternalConnection({
      provider: "jira-cloud",
      baseUrl: "https://register-full-dispatch-test.atlassian.invalid",
    });
    const fake = createFakeProviderTransport({
      responses: [
        { status: 200, bodyText: JSON.stringify({ id: "1", key: "PROJ", name: "P" }) },
        {
          status: 200,
          bodyText: JSON.stringify({
            transitions: [{ id: "21", name: "Start", to: { name: "In Progress" } }],
          }),
        },
      ],
    });
    await registry.register(connection, buildTokenManager(), {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: {
            allowedSchemes: ["https:"],
            allowedOrigins: [new URL(connection.baseUrl).origin],
          },
          resolveHostAddresses: async () => ["203.0.113.62"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
    });
    const envelopeId = "88888888-8888-4888-8888-888888888888";
    const client = providers.resolve(JIRA_PROVIDER_NAME);

    const got = (await client.get?.({
      connectionId: connection.id,
      resource: "project",
      projectKeyOrId: "PROJ",
    })) as {
      key: string;
    };
    expect(got.key).toBe("PROJ");

    const created = (await client.planCreate?.({
      connectionId: connection.id,
      resource: "issue",
      projectKeyOrId: "PROJ",
      issueType: "Task",
      summaryAdf: { type: "doc", version: 1, content: [] },
      envelopeId,
    })) as { action: string };
    expect(created.action).toBe("issue.create");

    const updated = (await client.planUpdate?.({
      connectionId: connection.id,
      resource: "issue",
      issueKey: "PROJ-1",
      expectedRevision: "rev-1",
      fields: { summary: "x" },
      envelopeId,
    })) as { action: string };
    expect(updated.action).toBe("issue.update");

    const transitioned = (await client.planTransition?.({
      connectionId: connection.id,
      issueKey: "PROJ-1",
      expectedRevision: "rev-1",
      transitionId: "21",
      envelopeId,
    })) as { action: string };
    expect(transitioned.action).toBe("issue.transition");

    const commented = (await client.planComment?.({
      connectionId: connection.id,
      issueKey: "PROJ-1",
      bodyAdf: { type: "doc", version: 1, content: [] },
      marker: "m-1",
      envelopeId,
    })) as { action: string };
    expect(commented.action).toBe("comment.create");
  });

  it("dispatch with no connectionId at all rejects with a validation error", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraCloudProvider({ providers, mutationApplyClients });

    const client = providers.resolve(JIRA_PROVIDER_NAME);
    await expect(client.get?.({ resource: "project" })).rejects.toMatchObject({
      kind: "validation",
    });
  });
});

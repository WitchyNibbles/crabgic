import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { GatewayHttpClient, ProviderRegistry, createFakeProviderTransport } from "@eo/gateway";
import type { GenericProviderClient, MutationApplyClient } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraConnectionConfigSchema } from "./jira-connection-config.js";
import {
  JIRA_DATACENTER_PROVIDER_KEY,
  registerJiraDatacenterProvider,
} from "./register-datacenter.js";

const BASE_URL = "https://dc-register-test.invalid";

describe("JIRA_DATACENTER_PROVIDER_KEY", () => {
  it("is a distinct key from Cloud's jira-cloud provider key (Gap: jira-cloud/jira-datacenter provider-key split)", () => {
    expect(JIRA_DATACENTER_PROVIDER_KEY).toBe("jira-datacenter");
  });
});

describe("registerJiraDatacenterProvider", () => {
  it("registers both the GenericProviderClient and MutationApplyClient under JIRA_DATACENTER_PROVIDER_KEY", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();

    const registry = registerJiraDatacenterProvider({ providers, mutationApplyClients });

    process.env.TEST_DC_REGISTER_PAT = "pat-value";
    const connection = buildExternalConnection({
      id: "66666666-6666-4666-8666-666666666666",
      provider: JIRA_DATACENTER_PROVIDER_KEY,
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: connection.id,
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "TEST_DC_REGISTER_PAT" },
    });
    const fake = createFakeProviderTransport({
      responses: [{ status: 200, bodyText: JSON.stringify([{ id: "1", key: "PROJ", name: "P" }]) }],
    });
    await registry.register(connection, config, {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
          resolveHostAddresses: async () => ["203.0.113.250"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
      skipDiscovery: true,
    });

    const genericClient = providers.resolve(JIRA_DATACENTER_PROVIDER_KEY);
    const result = await genericClient.search?.({
      resource: "project",
      connectionId: connection.id,
    });
    expect(result).toEqual([{ id: "1", key: "PROJ", name: "P" }]);

    const applyClient = mutationApplyClients.resolve(JIRA_DATACENTER_PROVIDER_KEY);
    expect(applyClient.buildRequest).toBeTypeOf("function");
  });

  it("a dispatch for an unregistered connection fails, never a silent no-op", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    registerJiraDatacenterProvider({ providers, mutationApplyClients });

    const genericClient = providers.resolve(JIRA_DATACENTER_PROVIDER_KEY);
    await expect(
      genericClient.search?.({ resource: "project", connectionId: "never-registered" }),
    ).rejects.toThrow();
  });

  it("routes get/planCreate/planUpdate/planTransition/planComment and the apply client's parseResponse/verify/reconcileAmbiguous", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerJiraDatacenterProvider({ providers, mutationApplyClients });

    process.env.TEST_DC_REGISTER_PAT2 = "pat-value-2";
    const connection = buildExternalConnection({
      id: "88888888-8888-4888-8888-888888888888",
      provider: JIRA_DATACENTER_PROVIDER_KEY,
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: connection.id,
      deploymentType: "datacenter",
      authMode: "pat",
      patSecretRef: { backend: "env", variable: "TEST_DC_REGISTER_PAT2" },
    });
    const fake = createFakeProviderTransport({
      responses: [
        { status: 200, bodyText: JSON.stringify({ id: "1", key: "PROJ", name: "P" }) }, // get
        {
          status: 200,
          bodyText: JSON.stringify({
            transitions: [{ id: "31", name: "Close", to: { name: "Done" } }],
          }),
        }, // planTransition's transitions read
      ],
    });
    await registry.register(connection, config, {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
          resolveHostAddresses: async () => ["203.0.113.251"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
      dcFeaturesOverride: {
        edition: "10.3",
        availableActions: ["issue.create", "issue.update", "issue.transition", "comment.create"],
        availableFields: "discovered-only",
      },
    });

    const genericClient = providers.resolve(JIRA_DATACENTER_PROVIDER_KEY);
    const project = await genericClient.get?.({
      resource: "project",
      connectionId: connection.id,
      projectKeyOrId: "PROJ",
    });
    expect(project).toEqual({ id: "1", key: "PROJ", name: "P" });

    const createPlan = await genericClient.planCreate?.({
      resource: "issue",
      connectionId: connection.id,
      projectKeyOrId: "PROJ",
      issueType: "Story",
      summaryAdf: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "s" }] }],
      },
      envelopeId: "99999999-9999-4999-8999-999999999999",
    });
    expect((createPlan as { action: string }).action).toBe("issue.create");

    const updatePlan = await genericClient.planUpdate?.({
      resource: "issue",
      connectionId: connection.id,
      issueKey: "PROJ-1",
      expectedRevision: "rev-1",
      fields: { summary: "new" },
      envelopeId: "99999999-9999-4999-8999-999999999999",
    });
    expect((updatePlan as { action: string }).action).toBe("issue.update");

    const transitionPlan = await genericClient.planTransition?.({
      connectionId: connection.id,
      issueKey: "PROJ-1",
      expectedRevision: "rev-1",
      transitionId: "31",
      envelopeId: "99999999-9999-4999-8999-999999999999",
      hasVerificationEvidence: true,
    });
    expect((transitionPlan as { action: string }).action).toBe("issue.transition");

    const commentPlan = await genericClient.planComment?.({
      connectionId: connection.id,
      issueKey: "PROJ-1",
      bodyAdf: { type: "doc", version: 1, content: [] },
      marker: "m-1",
      envelopeId: "99999999-9999-4999-8999-999999999999",
    });
    expect((commentPlan as { action: string }).action).toBe("comment.create");

    const applyClient = mutationApplyClients.resolve(JIRA_DATACENTER_PROVIDER_KEY);
    const parsed = applyClient.parseResponse(createPlan as never, {
      status: 201,
      headers: {},
      bodyText: JSON.stringify({ key: "PROJ-9" }),
    });
    expect(parsed.appliedRevision).toBe("PROJ-9");

    const reconciled = await applyClient.reconcileAmbiguous?.(
      createPlan as never,
      new Error("timeout"),
    );
    expect(reconciled).toBeUndefined(); // no marker reconciler match scripted — genuinely unknown, not a guess
  });

  it("rejects a disallowed basic-auth connection pre-network via the routed apply client too", async () => {
    const providers = new ProviderRegistry<GenericProviderClient>();
    const mutationApplyClients = new ProviderRegistry<MutationApplyClient>();
    const registry = registerJiraDatacenterProvider({ providers, mutationApplyClients });

    const connection = buildExternalConnection({
      id: "77777777-7777-4777-8777-777777777777",
      provider: JIRA_DATACENTER_PROVIDER_KEY,
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    const config = JiraConnectionConfigSchema.parse({
      externalConnectionId: connection.id,
      deploymentType: "datacenter",
      authMode: "basic",
      allowBasicAuth: false,
      basicAuthUsernameSecretRef: { backend: "env", variable: "X" },
      basicAuthPasswordSecretRef: { backend: "env", variable: "Y" },
    });

    await expect(
      registry.register(connection, config, {
        buildHttpClient: async () => {
          throw new Error("should never be called");
        },
      }),
    ).rejects.toThrow(ConnectorError);
  });
});

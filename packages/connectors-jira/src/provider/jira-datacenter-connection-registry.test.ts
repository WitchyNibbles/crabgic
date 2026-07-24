import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import {
  JiraDatacenterConnectionNotRegisteredError,
  JiraDatacenterConnectionRegistry,
} from "./jira-datacenter-connection-registry.js";
import { JiraConnectionConfigSchema } from "./jira-connection-config.js";

const BASE_URL = "https://dc-registry-test.invalid";

function buildConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return JiraConnectionConfigSchema.parse({
    externalConnectionId: "44444444-4444-4444-8444-444444444444",
    deploymentType: "datacenter",
    authMode: "pat",
    patSecretRef: { backend: "env", variable: "TEST_DC_REGISTRY_PAT" },
    ...overrides,
  });
}

describe("JiraDatacenterConnectionRegistry", () => {
  it("register() then get() returns a fully-wired entry", async () => {
    process.env.TEST_DC_REGISTRY_PAT = "pat-value";
    const registry = new JiraDatacenterConnectionRegistry();
    const connection = buildExternalConnection({
      id: "44444444-4444-4444-8444-444444444444",
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    const fake = createFakeProviderTransport({ responses: [] });
    const entry = await registry.register(connection, buildConfig(), {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
          resolveHostAddresses: async () => ["203.0.113.240"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
    });

    expect(entry.resourceClient).toBeDefined();
    expect(registry.isRegistered(connection.id)).toBe(true);
    expect(registry.get(connection.id)).toBe(entry);
  });

  it("get() throws JiraDatacenterConnectionNotRegisteredError for an unregistered connection id", () => {
    const registry = new JiraDatacenterConnectionRegistry();
    expect(() => registry.get("never-registered")).toThrow(
      JiraDatacenterConnectionNotRegisteredError,
    );
  });

  it("register() rejects pre-network (no HTTP client built) for a disallowed basic-auth config", async () => {
    const registry = new JiraDatacenterConnectionRegistry();
    const connection = buildExternalConnection({
      id: "55555555-5555-4555-8555-555555555555",
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    let httpClientBuilt = false;
    await expect(
      registry.register(
        connection,
        buildConfig({
          externalConnectionId: connection.id,
          authMode: "basic",
          allowBasicAuth: false,
          basicAuthUsernameSecretRef: { backend: "env", variable: "X" },
          basicAuthPasswordSecretRef: { backend: "env", variable: "Y" },
        }),
        {
          buildHttpClient: async () => {
            httpClientBuilt = true;
            throw new Error("should never be called");
          },
        },
      ),
    ).rejects.toThrow(ConnectorError);
    expect(httpClientBuilt).toBe(false);
  });
});

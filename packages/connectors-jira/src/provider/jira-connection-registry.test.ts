import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import {
  JiraConnectionNotRegisteredError,
  JiraConnectionRegistry,
} from "./jira-connection-registry.js";

function buildTokenManager(): JiraTokenManager {
  return new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
}

describe("JiraConnectionRegistry", () => {
  it("throws JiraConnectionNotRegisteredError for a connection that was never registered", () => {
    const registry = new JiraConnectionRegistry();
    expect(() => registry.get("never-registered")).toThrow(JiraConnectionNotRegisteredError);
    expect(registry.isRegistered("never-registered")).toBe(false);
  });

  it("registers a connection and makes it synchronously resolvable afterward", async () => {
    const registry = new JiraConnectionRegistry();
    const connection = buildExternalConnection({
      provider: "jira-cloud",
      baseUrl: "https://registry-test.atlassian.invalid",
    });
    const fake = createFakeProviderTransport({ responses: [] });

    await registry.register(connection, buildTokenManager(), {
      buildHttpClient: async () =>
        new GatewayHttpClient({
          allowlist: {
            allowedSchemes: ["https:"],
            allowedOrigins: [new URL(connection.baseUrl).origin],
          },
          resolveHostAddresses: async () => ["203.0.113.50"],
          sendRequest: fake.send,
          sleep: async () => undefined,
        }),
    });

    expect(registry.isRegistered(connection.id)).toBe(true);
    const entry = registry.get(connection.id);
    expect(entry.resourceClient).toBeDefined();
    expect(entry.applyDeps).toBeDefined();
  });

  it("shares one AttachmentStagingRegistry instance across every registered connection", async () => {
    const registry = new JiraConnectionRegistry();
    const connectionA = buildExternalConnection({ provider: "jira-cloud" });
    const connectionB = buildExternalConnection({ provider: "jira-cloud" });
    const buildHttpClient = async () =>
      new GatewayHttpClient({
        allowlist: {
          allowedSchemes: ["https:"],
          allowedOrigins: ["https://example.atlassian.net"],
        },
        resolveHostAddresses: async () => ["203.0.113.51"],
        sendRequest: createFakeProviderTransport({ responses: [] }).send,
        sleep: async () => undefined,
      });

    await registry.register(connectionA, buildTokenManager(), { buildHttpClient });
    await registry.register(connectionB, buildTokenManager(), { buildHttpClient });

    expect(registry.get(connectionA.id).applyDeps.attachmentStaging).toBe(
      registry.attachmentStaging,
    );
    expect(registry.get(connectionB.id).applyDeps.attachmentStaging).toBe(
      registry.attachmentStaging,
    );
  });
});

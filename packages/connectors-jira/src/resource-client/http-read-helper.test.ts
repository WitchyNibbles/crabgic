import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, type ExternalConnection } from "@crabgic/contracts";
import type { GatewayHttpClient } from "@crabgic/gateway";
import { JiraTokenManager } from "../auth/token-manager.js";
import { jiraGetJson, type JiraHttpContext } from "./http-read-helper.js";

const CONNECTION: ExternalConnection = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "88888888-8888-4888-8888-888888888888",
  provider: "jira-cloud",
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: [],
  allowedResources: ["issue"],
  allowedActions: ["read"],
  discoveryTtlSeconds: 900,
  secretRef: { backend: "env", variable: "TOKEN" },
};

function capturingClient(sent: Record<string, string>[]): GatewayHttpClient {
  return {
    request: async (req: { headers?: Record<string, string> }) => {
      sent.push(req.headers ?? {});
      return { status: 200, headers: {}, bodyText: JSON.stringify({ ok: true }) };
    },
  } as unknown as GatewayHttpClient;
}

function context(overrides: Partial<JiraHttpContext> = {}): JiraHttpContext {
  return {
    connection: CONNECTION,
    httpClient: capturingClient([]),
    tokenManager: new JiraTokenManager({
      fetchToken: async () => ({ accessToken: "oauth-tok", expiresInSeconds: 3600, scopes: [] }),
    }),
    ...overrides,
  };
}

const SCHEMA = z.object({ ok: z.boolean() });

/**
 * Issue #135: the authorization header was a hardcoded `Bearer
 * ${token.accessToken}` here, so OAuth was the only expressible Cloud
 * credential — and Atlassian rejects API tokens presented as Bearer.
 */
describe("jiraGetJson — the authorization header", () => {
  it("uses the connection's own auth-header provider when one is configured", async () => {
    const sent: Record<string, string>[] = [];
    await jiraGetJson(
      context({
        httpClient: capturingClient(sent),
        authHeaderProvider: async () => ({ authorization: "Basic ZW1haWw6dG9rZW4=" }),
      }),
      "/rest/api/3/myself",
      SCHEMA,
      "myself",
    );
    expect(sent[0]?.["authorization"]).toBe("Basic ZW1haWw6dG9rZW4=");
  });

  it("falls back to the OAuth Bearer scheme when no provider is configured", async () => {
    const sent: Record<string, string>[] = [];
    await jiraGetJson(
      context({ httpClient: capturingClient(sent) }),
      "/rest/api/3/myself",
      SCHEMA,
      "myself",
    );
    expect(sent[0]?.["authorization"]).toBe("Bearer oauth-tok");
  });

  it("still sends the JSON accept header alongside whichever scheme is used", async () => {
    const sent: Record<string, string>[] = [];
    await jiraGetJson(
      context({
        httpClient: capturingClient(sent),
        authHeaderProvider: async () => ({ authorization: "Basic x" }),
      }),
      "/rest/api/3/myself",
      SCHEMA,
      "myself",
    );
    expect(sent[0]?.["accept"]).toBe("application/json");
  });

  it("never falls back to Bearer once a provider is configured, even a failing one", async () => {
    // A configured-but-broken credential must surface as an auth failure,
    // never as a silent retry under a different scheme with a token the
    // operator did not choose.
    await expect(
      jiraGetJson(
        context({ authHeaderProvider: async () => Promise.reject(new Error("vault down")) }),
        "/rest/api/3/myself",
        SCHEMA,
        "myself",
      ),
    ).rejects.toThrow(/vault down/);
  });
});

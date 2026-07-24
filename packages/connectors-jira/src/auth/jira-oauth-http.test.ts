import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildJiraOAuthTokenFetcher } from "./jira-oauth-http.js";

const TOKEN_URL = "https://auth.atlassian.invalid/oauth/token";

function buildClient(script: Parameters<typeof createFakeProviderTransport>[0]) {
  const fake = createFakeProviderTransport(script);
  const client = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(TOKEN_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.9"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return { client, fake };
}

describe("buildJiraOAuthTokenFetcher", () => {
  it("resolves client id/secret via secret references, POSTs client_credentials, and parses the response", async () => {
    process.env.TEST_JIRA_CLIENT_ID = "client-id-value";
    process.env.TEST_JIRA_CLIENT_SECRET = "client-secret-value";
    const { client, fake } = buildClient({
      responses: [
        {
          status: 200,
          bodyText: JSON.stringify({
            access_token: "at-1",
            expires_in: 3600,
            scope: "read:jira-work write:jira-work",
          }),
        },
      ],
    });

    const fetchToken = buildJiraOAuthTokenFetcher(
      {
        clientId: { backend: "env", variable: "TEST_JIRA_CLIENT_ID" },
        clientSecret: { backend: "env", variable: "TEST_JIRA_CLIENT_SECRET" },
        scopes: ["read:jira-work", "write:jira-work"],
      },
      client,
      { tokenUrl: TOKEN_URL },
    );

    const result = await fetchToken();

    expect(result.accessToken).toBe("at-1");
    expect(result.expiresInSeconds).toBe(3600);
    expect(result.scopes).toEqual(["read:jira-work", "write:jira-work"]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe("POST");
  });

  it("never leaks the resolved client secret into the thrown error on a failure response", async () => {
    process.env.TEST_JIRA_CLIENT_ID2 = "client-id-value";
    process.env.TEST_JIRA_CLIENT_SECRET2 = "super-secret-do-not-leak";
    const { client } = buildClient({
      responses: [{ status: 401, bodyText: JSON.stringify({ error: "invalid_client" }) }],
    });

    const fetchToken = buildJiraOAuthTokenFetcher(
      {
        clientId: { backend: "env", variable: "TEST_JIRA_CLIENT_ID2" },
        clientSecret: { backend: "env", variable: "TEST_JIRA_CLIENT_SECRET2" },
        scopes: ["read:jira-work"],
      },
      client,
      { tokenUrl: TOKEN_URL },
    );

    try {
      await fetchToken();
      throw new Error("expected fetchToken to throw");
    } catch (err) {
      const asString = String(err instanceof Error ? (err.stack ?? err.message) : err);
      expect(asString).not.toContain("super-secret-do-not-leak");
    }
  });

  it("rejects when the token response is malformed JSON", async () => {
    process.env.TEST_JIRA_CLIENT_ID3 = "id";
    process.env.TEST_JIRA_CLIENT_SECRET3 = "secret";
    const { client } = buildClient({
      responses: [{ status: 200, bodyText: "{ not json" }],
    });
    const fetchToken = buildJiraOAuthTokenFetcher(
      {
        clientId: { backend: "env", variable: "TEST_JIRA_CLIENT_ID3" },
        clientSecret: { backend: "env", variable: "TEST_JIRA_CLIENT_SECRET3" },
        scopes: [],
      },
      client,
      { tokenUrl: TOKEN_URL },
    );

    await expect(fetchToken()).rejects.toThrow();
  });
});

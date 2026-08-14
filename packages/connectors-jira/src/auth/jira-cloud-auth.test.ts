import { describe, expect, it } from "vitest";
import { ConnectorError } from "@crabgic/contracts";
import type { JiraConnectionConfig } from "../provider/jira-connection-config.js";
import { resolveJiraCloudAuthHeaderProvider } from "./jira-cloud-auth.js";

function config(overrides: Partial<JiraConnectionConfig> = {}): JiraConnectionConfig {
  return {
    externalConnectionId: "conn-1",
    deploymentType: "cloud",
    authMode: "basic",
    allowBasicAuth: false,
    ...overrides,
  };
}

/** Env var NAMES the tests plant values under — locators, never credentials. */
const CLIENT_ID_VAR = "CRABGIC_TEST_CLIENT_ID";
const CLIENT_SECRET_VAR = "CRABGIC_TEST_CLIENT_SECRET";

/**
 * Issue #135, adjacent note, promoted to a defect: "`jiraGetJson()` sends
 * `Bearer ${accessToken}` and `JiraTokenManager` is built around OAuth
 * 2.0 ... Atlassian rejects API tokens (`ATATT…`) sent as Bearer; they
 * authenticate only as HTTP Basic `email:token`." So a Cloud connection
 * configured with the credential an operator actually has could never
 * authenticate, whatever else was fixed.
 */
describe("resolveJiraCloudAuthHeaderProvider", () => {
  describe("authMode: basic — Atlassian's documented API-token mechanism", () => {
    it("emits a Basic header over email:apiToken, not a Bearer one", async () => {
      process.env.CRABGIC_TEST_EMAIL = "ops@example.com";
      process.env.CRABGIC_TEST_TOKEN = "ATATT-api-token";
      try {
        const provider = resolveJiraCloudAuthHeaderProvider(
          config({
            basicAuthUsernameSecretRef: { backend: "env", variable: "CRABGIC_TEST_EMAIL" },
            basicAuthPasswordSecretRef: { backend: "env", variable: "CRABGIC_TEST_TOKEN" },
          }),
        );
        const headers = await provider();
        const expected = Buffer.from("ops@example.com:ATATT-api-token", "utf8").toString("base64");
        expect(headers["authorization"]).toBe(`Basic ${expected}`);
      } finally {
        delete process.env.CRABGIC_TEST_EMAIL;
        delete process.env.CRABGIC_TEST_TOKEN;
      }
    });

    it("does NOT require the allowBasicAuth opt-in that Data Center's basic mode does", async () => {
      // The guard exists because DC basic auth means a real directory
      // username+password. On Cloud, basic auth means email + a revocable
      // API token — Atlassian's own recommended mechanism — so gating it
      // behind an opt-in would refuse the normal path.
      process.env.CRABGIC_TEST_EMAIL = "ops@example.com";
      process.env.CRABGIC_TEST_TOKEN = "ATATT-api-token";
      try {
        const provider = resolveJiraCloudAuthHeaderProvider(
          config({
            allowBasicAuth: false,
            basicAuthUsernameSecretRef: { backend: "env", variable: "CRABGIC_TEST_EMAIL" },
            basicAuthPasswordSecretRef: { backend: "env", variable: "CRABGIC_TEST_TOKEN" },
          }),
        );
        await expect(provider()).resolves.toBeDefined();
      } finally {
        delete process.env.CRABGIC_TEST_EMAIL;
        delete process.env.CRABGIC_TEST_TOKEN;
      }
    });

    it("refuses pre-network when the username reference is missing", () => {
      expect(() =>
        resolveJiraCloudAuthHeaderProvider(
          config({ basicAuthPasswordSecretRef: { backend: "env", variable: "X" } }),
        ),
      ).toThrow(ConnectorError);
    });

    it("refuses pre-network when the password reference is missing", () => {
      expect(() =>
        resolveJiraCloudAuthHeaderProvider(
          config({ basicAuthUsernameSecretRef: { backend: "env", variable: "X" } }),
        ),
      ).toThrow(/basicAuthPasswordSecretRef/);
    });

    it("resolves the secret fresh on every call, so a rotated token is picked up", async () => {
      process.env.CRABGIC_TEST_EMAIL = "ops@example.com";
      process.env.CRABGIC_TEST_TOKEN = "first";
      try {
        const provider = resolveJiraCloudAuthHeaderProvider(
          config({
            basicAuthUsernameSecretRef: { backend: "env", variable: "CRABGIC_TEST_EMAIL" },
            basicAuthPasswordSecretRef: { backend: "env", variable: "CRABGIC_TEST_TOKEN" },
          }),
        );
        const before = await provider();
        process.env.CRABGIC_TEST_TOKEN = "second";
        const after = await provider();
        expect(after["authorization"]).not.toBe(before["authorization"]);
      } finally {
        delete process.env.CRABGIC_TEST_EMAIL;
        delete process.env.CRABGIC_TEST_TOKEN;
      }
    });
  });

  describe("authMode: oauth — the service-account client-credentials flow", () => {
    it("refuses pre-network when the client id reference is missing", () => {
      expect(() =>
        resolveJiraCloudAuthHeaderProvider(
          config({
            authMode: "oauth",
            oauthClientSecretRef: { backend: "env", variable: CLIENT_SECRET_VAR },
          }),
          { httpClient: {} as never },
        ),
      ).toThrow(/oauthClientIdSecretRef/);
    });

    it("refuses pre-network when the client secret reference is missing", () => {
      expect(() =>
        resolveJiraCloudAuthHeaderProvider(
          config({
            authMode: "oauth",
            oauthClientIdSecretRef: { backend: "env", variable: CLIENT_ID_VAR },
          }),
          { httpClient: {} as never },
        ),
      ).toThrow(/oauthClientSecretRef/);
    });

    it("refuses when no HTTP client is supplied to reach the token endpoint", () => {
      expect(() =>
        resolveJiraCloudAuthHeaderProvider(
          config({
            authMode: "oauth",
            oauthClientIdSecretRef: { backend: "env", variable: CLIENT_ID_VAR },
            oauthClientSecretRef: { backend: "env", variable: CLIENT_SECRET_VAR },
          }),
        ),
      ).toThrow(ConnectorError);
    });

    it("emits a Bearer header carrying the minted access token", async () => {
      process.env[CLIENT_ID_VAR] = "client-id";
      process.env[CLIENT_SECRET_VAR] = "client-secret";
      try {
        const provider = resolveJiraCloudAuthHeaderProvider(
          config({
            authMode: "oauth",
            oauthClientIdSecretRef: { backend: "env", variable: CLIENT_ID_VAR },
            oauthClientSecretRef: { backend: "env", variable: CLIENT_SECRET_VAR },
          }),
          {
            httpClient: {
              request: async () => ({
                status: 200,
                headers: {},
                bodyText: JSON.stringify({
                  access_token: "minted-token",
                  expires_in: 3600,
                  scope: "read:jira-work",
                }),
              }),
            } as never,
          },
        );
        expect((await provider())["authorization"]).toBe("Bearer minted-token");
      } finally {
        delete process.env[CLIENT_ID_VAR];
        delete process.env[CLIENT_SECRET_VAR];
      }
    });
  });

  it("refuses authMode 'pat' — a Data Center concept with no Cloud equivalent", () => {
    expect(() => resolveJiraCloudAuthHeaderProvider(config({ authMode: "pat" }))).toThrow(
      /pat|Data Center/i,
    );
  });

  it("refuses a config whose deployment is not cloud, rather than silently mis-authenticating", () => {
    expect(() =>
      resolveJiraCloudAuthHeaderProvider(config({ deploymentType: "datacenter" })),
    ).toThrow(ConnectorError);
  });
});

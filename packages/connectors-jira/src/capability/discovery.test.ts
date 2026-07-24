import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { discoverJiraCapabilitySnapshot, discoverJiraFieldMetadata } from "./discovery.js";
import { JiraTokenManager } from "../auth/token-manager.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

function buildCtx(
  responses: Parameters<typeof createFakeProviderTransport>[0]["responses"],
): JiraHttpContext {
  const connection = buildExternalConnection({
    provider: "jira-cloud",
    baseUrl: "https://example-discovery.atlassian.invalid",
  });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(connection.baseUrl).origin] },
    resolveHostAddresses: async () => ["203.0.113.10"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  return { connection, httpClient, tokenManager };
}

describe("discoverJiraCapabilitySnapshot", () => {
  it("marks a recognized Cloud edition as writable (isReadOnly: false)", async () => {
    const ctx = buildCtx([
      { status: 200, bodyText: JSON.stringify({ version: "1001.0.0", deploymentType: "Cloud" }) },
      {
        status: 200,
        bodyText: JSON.stringify({
          permissions: {
            BROWSE_PROJECTS: { havePermission: true },
            EDIT_ISSUES: { havePermission: true },
          },
        }),
      },
    ]);

    const snapshot = await discoverJiraCapabilitySnapshot(ctx);

    expect(snapshot.edition).toBe("cloud");
    expect(snapshot.isReadOnly).toBe(false);
    expect(snapshot.product).toBe("jira");
    expect(snapshot.permissions).toContain("BROWSE_PROJECTS");
    expect(snapshot.permissions).toContain("EDIT_ISSUES");
  });

  it("defaults an unrecognized edition/deploymentType to read-only", async () => {
    const ctx = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({ version: "9.4.0", deploymentType: "SomeFutureDeployment" }),
      },
      { status: 200, bodyText: JSON.stringify({ permissions: {} }) },
    ]);

    const snapshot = await discoverJiraCapabilitySnapshot(ctx);

    expect(snapshot.edition).toBe("unknown");
    expect(snapshot.isReadOnly).toBe(true);
  });

  it("only includes permissions the caller actually has (havePermission: true)", async () => {
    const ctx = buildCtx([
      { status: 200, bodyText: JSON.stringify({ version: "1.0.0", deploymentType: "Cloud" }) },
      {
        status: 200,
        bodyText: JSON.stringify({
          permissions: {
            BROWSE_PROJECTS: { havePermission: true },
            ADMINISTER: { havePermission: false },
          },
        }),
      },
    ]);

    const snapshot = await discoverJiraCapabilitySnapshot(ctx);

    expect(snapshot.permissions).toEqual(["BROWSE_PROJECTS"]);
  });
});

describe("discoverJiraFieldMetadata", () => {
  it("returns discovered field metadata, defaulting a missing schema type to an unrecognized sentinel", async () => {
    const ctx = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify([
          {
            id: "customfield_10010",
            name: "Story Points",
            custom: true,
            schema: { type: "number" },
          },
          { id: "customfield_10099", name: "Weird Field", custom: true },
        ]),
      },
    ]);

    const fields = await discoverJiraFieldMetadata(ctx);

    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ id: "customfield_10010", schemaType: "number" });
    expect(fields[1]?.schemaType).not.toBe("number");
  });
});

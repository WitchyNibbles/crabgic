import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { discoverJiraDatacenterCapabilitySnapshot } from "./discovery-datacenter.js";

const BASE_URL = "https://dc-discovery-test.invalid";

function buildCtx(
  responses: Parameters<typeof createFakeProviderTransport>[0]["responses"],
): JiraDatacenterHttpContext {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: BASE_URL,
  });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.210"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer x" }),
  };
}

describe("discoverJiraDatacenterCapabilitySnapshot", () => {
  it("resolves edition 10.3 and marks writable when the matrix recognizes it", async () => {
    const ctx = buildCtx([
      { status: 200, bodyText: JSON.stringify({ version: "10.3.1" }) },
      {
        status: 200,
        bodyText: JSON.stringify({ permissions: { BROWSE_PROJECTS: { havePermission: true } } }),
      },
    ]);
    const snapshot = await discoverJiraDatacenterCapabilitySnapshot(ctx);
    expect(snapshot.edition).toBe("10.3");
    expect(snapshot.isReadOnly).toBe(false);
    expect(snapshot.apiFamilies).toEqual(["rest-v2", "agile-1.0"]);
    expect(snapshot.permissions).toContain("BROWSE_PROJECTS");
  });

  it("resolves edition 11.3 and marks writable", async () => {
    const ctx = buildCtx([
      { status: 200, bodyText: JSON.stringify({ version: "11.3.0" }) },
      { status: 200, bodyText: JSON.stringify({ permissions: {} }) },
    ]);
    const snapshot = await discoverJiraDatacenterCapabilitySnapshot(ctx);
    expect(snapshot.edition).toBe("11.3");
    expect(snapshot.isReadOnly).toBe(false);
  });

  it("falls back to typed unsupported-safe read-only for an unrecognized edition/version — never guessed, never a raw fallback", async () => {
    const ctx = buildCtx([
      { status: 200, bodyText: JSON.stringify({ version: "8.20.1" }) },
      { status: 200, bodyText: JSON.stringify({ permissions: {} }) },
    ]);
    const snapshot = await discoverJiraDatacenterCapabilitySnapshot(ctx);
    expect(snapshot.edition).toBe("unknown");
    expect(snapshot.isReadOnly).toBe(true);
    expect(snapshot.actions).toEqual([]);
  });
});

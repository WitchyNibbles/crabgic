import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { z } from "zod";
import { jiraDatacenterGetJson } from "./jira-datacenter-http-context.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";

const BASE_URL = "https://dc-http-context-test.invalid";

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
    resolveHostAddresses: async () => ["203.0.113.200"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer dc-pat" }),
  };
}

describe("jiraDatacenterGetJson", () => {
  it("performs an authenticated GET using ctx.authHeaderProvider and validates the response against the schema", async () => {
    const ctx = buildCtx([{ status: 200, bodyText: JSON.stringify({ ok: true }) }]);
    const result = await jiraDatacenterGetJson(
      ctx,
      "/rest/api/2/myself",
      z.object({ ok: z.boolean() }),
      "myself",
    );
    expect(result.ok).toBe(true);
  });

  it("maps a 4xx/5xx status to a canonical ConnectorError attributed to jira-datacenter", async () => {
    const ctx = buildCtx([{ status: 404, bodyText: "" }]);
    await expect(
      jiraDatacenterGetJson(ctx, "/rest/api/2/issue/PROJ-1", z.object({}), "issues.get"),
    ).rejects.toMatchObject({ kind: "not_found", provider: "jira-datacenter" });
  });

  it("throws ConnectorError.validation when the response fails boundary validation", async () => {
    const ctx = buildCtx([{ status: 200, bodyText: JSON.stringify({ unexpected: true }) }]);
    await expect(
      jiraDatacenterGetJson(ctx, "/rest/api/2/myself", z.object({ ok: z.boolean() }), "myself"),
    ).rejects.toThrow(ConnectorError);
  });
});

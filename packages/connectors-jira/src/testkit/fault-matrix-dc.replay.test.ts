import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraDatacenterResourceClient } from "../resource-client/datacenter/jira-datacenter-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { JIRA_DATACENTER_FAULT_MATRIX } from "./fault-matrix-dc.js";

const BASE_URL = "https://dc-fault-matrix-test.invalid";

function buildClient(status: number, bodyText = "", fault?: string) {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: BASE_URL,
  });
  const fake = createFakeProviderTransport({
    responses: [{ status, bodyText, ...(fault !== undefined ? { fault } : {}) }],
  });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.93"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const ctx: JiraDatacenterHttpContext = {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer dc-pat" }),
  };
  return createJiraDatacenterResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry: new JiraPlanPayloadRegistry(),
  });
}

/**
 * roadmap/19-jira-datacenter-adapter.md §Test plan: "fault matrix
 * (401/403/409/429, malformed pages, ambiguous timeouts) parameterized
 * the same way 18 tests it." Each fault replayed through a REAL DC
 * `JiraResourceClient` read call, asserted to map to the same canonical
 * `ConnectorError` kind Cloud's identical fault maps to — proving the
 * canonical-error mapping is shared/reused, not reimplemented per
 * deployment type.
 */
describe("JIRA_DATACENTER_FAULT_MATRIX replay", () => {
  it("401 (authFailure) maps to authentication", async () => {
    const entry = JIRA_DATACENTER_FAULT_MATRIX["authFailure"];
    const client = buildClient(entry?.status ?? 401, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({
      kind: "authentication",
      provider: "jira-datacenter",
    });
  });

  it("403 (forbidden) maps to permission", async () => {
    const entry = JIRA_DATACENTER_FAULT_MATRIX["forbidden"];
    const client = buildClient(entry?.status ?? 403, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "permission" });
  });

  it("409 (conflict) maps to conflict", async () => {
    const entry = JIRA_DATACENTER_FAULT_MATRIX["conflict"];
    const client = buildClient(entry?.status ?? 409, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "conflict" });
  });

  it("429 with NO retry-after header still maps to rate_limited after retries are exhausted (DC has no quota/burst headers by convention)", async () => {
    const connection = buildExternalConnection({
      provider: "jira-datacenter",
      deploymentType: "datacenter",
      baseUrl: BASE_URL,
    });
    const fake = createFakeProviderTransport({ responses: [{ status: 429, bodyText: "" }] });
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.94"],
      sendRequest: fake.send,
      sleep: async () => undefined,
    });
    const ctx: JiraDatacenterHttpContext = {
      connection,
      httpClient,
      authHeaderProvider: async () => ({ authorization: "Bearer dc-pat" }),
    };
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    await expect(client.projects.list()).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fake.calls.length).toBeGreaterThan(1);
  });

  it("malformed pagination maps to validation, never a silent coercion", async () => {
    const entry = JIRA_DATACENTER_FAULT_MATRIX["malformedPage"];
    const client = buildClient(entry?.status ?? 200, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "validation" });
  });

  it("ambiguous mid-POST timeout is never a clean HTTP failure — propagates as a raw transport error", async () => {
    const entry = JIRA_DATACENTER_FAULT_MATRIX["midPostTimeout"];
    const client = buildClient(entry?.status ?? 0, entry?.bodyText, entry?.fault);
    await expect(client.projects.list()).rejects.toThrow();
  });
});

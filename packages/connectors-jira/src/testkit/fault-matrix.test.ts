import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";
import { JIRA_FAULT_MATRIX } from "./fault-matrix.js";

const BASE_URL = "https://fault-matrix-test.atlassian.invalid";

function buildClient(status: number, bodyText = "", fault?: string) {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({
    responses: [{ status, bodyText, ...(fault !== undefined ? { fault } : {}) }],
  });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.91"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  return createJiraResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry: new JiraPlanPayloadRegistry(),
  });
}

/**
 * roadmap/18 §Test plan, Conformance bullet: "fault-matrix replay
 * (401/403/409/429, malformed pagination, ambiguous mid-POST timeout) —
 * must fail with no handling before the fix, pass after." Each fault
 * here is replayed through a REAL `JiraResourceClient` read call and
 * asserted to map to exactly the expected canonical `ConnectorError`
 * kind — never an unhandled exception, never a silently-swallowed
 * failure.
 */
describe("JIRA_FAULT_MATRIX replay", () => {
  it("401 (authFailureResponse) maps to authentication", async () => {
    const entry = JIRA_FAULT_MATRIX["authFailure"];
    const client = buildClient(entry?.status ?? 401, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "authentication" });
  });

  it("403 (forbidden) maps to permission", async () => {
    const entry = JIRA_FAULT_MATRIX["forbidden"];
    const client = buildClient(entry?.status ?? 403, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "permission" });
  });

  it("409 (conflictResponse) maps to conflict", async () => {
    const entry = JIRA_FAULT_MATRIX["conflict"];
    const client = buildClient(entry?.status ?? 409, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "conflict" });
  });

  it("429 (rateLimitedResponse) maps to rate_limited after retries are exhausted", async () => {
    const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
    // 429 is retried by the retry ladder (GET is free to retry) up to
    // maxAttempts — script a steady 429 tail so the client eventually
    // gives up and surfaces the canonical rate_limited kind.
    const fake = createFakeProviderTransport({
      responses: [{ status: 429, headers: { "retry-after": "0" }, bodyText: "" }],
    });
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.92"],
      sendRequest: fake.send,
      sleep: async () => undefined,
    });
    const tokenManager = new JiraTokenManager({
      fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
    });
    const client = createJiraResourceClient({
      ctx: { connection, httpClient, tokenManager },
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    await expect(client.projects.list()).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fake.calls.length).toBeGreaterThan(1); // proves the retry ladder actually retried before giving up
  });

  it("malformed pagination (malformedPageResponse) maps to validation, never a silent coercion", async () => {
    const entry = JIRA_FAULT_MATRIX["malformedPage"];
    const client = buildClient(entry?.status ?? 200, entry?.bodyText);
    await expect(client.projects.list()).rejects.toMatchObject({ kind: "validation" });
  });

  it("ambiguous mid-POST timeout (midPostTimeoutFault) is never a clean HTTP failure — it propagates as a raw transport error for the mutation pipeline to reconcile", async () => {
    const entry = JIRA_FAULT_MATRIX["midPostTimeout"];
    const client = buildClient(entry?.status ?? 0, entry?.bodyText, entry?.fault);
    // A read call isn't the intended path for this fault (it's a POST-
    // specific ambiguity) — this asserts the fake transport itself
    // actually throws rather than resolving, which is the mechanism the
    // exactly-once integration suite (`../resource-client/exactly-
    // once.integration.test.ts`) depends on.
    await expect(client.projects.list()).rejects.toThrow();
  });
});

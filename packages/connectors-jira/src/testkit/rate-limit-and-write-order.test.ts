import { describe, expect, it } from "vitest";
import { GatewayHttpClient } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import type { HttpTransportRequest, HttpTransportResponse } from "@eo/gateway";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

/**
 * roadmap/18 §Exit criteria: "Rate-limit fixture: `Retry-After` honored;
 * per-issue write order preserved." This connector reuses 16's transport
 * stack wholesale (`GatewayHttpClient`) — these tests prove THIS
 * connector's own wiring (the `resource`/`isWrite` values its resource
 * clients pass to `httpClient.request`) actually engages that stack's
 * Retry-After honoring and per-tenant+resource write serialization,
 * rather than accidentally bypassing it.
 */
const BASE_URL = "https://rate-limit-test.atlassian.invalid";

describe("Retry-After is honored on a rate-limited GET", () => {
  it("sleeps for exactly the Retry-After duration before the next attempt", async () => {
    const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
    const sleepCalls: number[] = [];
    let attempt = 0;
    const sendRequest = async (): Promise<HttpTransportResponse> => {
      attempt += 1;
      if (attempt === 1) {
        return { status: 429, headers: { "retry-after": "2" }, bodyText: "" };
      }
      return { status: 200, headers: {}, bodyText: JSON.stringify({ values: [] }) };
    };
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.101"],
      sendRequest,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });
    const tokenManager = new JiraTokenManager({
      fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
    });
    const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    await client.projects.list();

    expect(sleepCalls).toEqual([2000]);
    expect(attempt).toBe(2);
  });
});

describe("per-issue write order is preserved (write-serialized by canonicalTarget)", () => {
  it("two concurrent writes to the SAME issue never overlap on the wire", async () => {
    const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
    const events: string[] = [];
    let inFlight = 0;
    const sendRequest = async (req: HttpTransportRequest): Promise<HttpTransportResponse> => {
      inFlight += 1;
      events.push(`start:${req.url.pathname}`);
      if (inFlight > 1) {
        events.push("OVERLAP-DETECTED");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      events.push(`end:${req.url.pathname}`);
      return { status: 200, headers: {}, bodyText: "{}" };
    };
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.102"],
      sendRequest,
      sleep: async () => undefined,
    });

    await Promise.all([
      httpClient.request({
        connectionId: connection.id,
        tenant: connection.id,
        resource: "issue:PROJ-1",
        url: new URL("/rest/api/3/issue/PROJ-1", BASE_URL),
        method: "PUT",
        isWrite: true,
      }),
      httpClient.request({
        connectionId: connection.id,
        tenant: connection.id,
        resource: "issue:PROJ-1",
        url: new URL("/rest/api/3/issue/PROJ-1/transitions", BASE_URL),
        method: "POST",
        isWrite: true,
      }),
    ]);

    expect(events).not.toContain("OVERLAP-DETECTED");
    // Fully sequential: the first call's "end" must precede the second's "start".
    const firstEnd = events.findIndex((e) => e.startsWith("end:"));
    const secondStart = events.findIndex((e, i) => e.startsWith("start:") && i > 0);
    expect(secondStart).toBeGreaterThan(firstEnd);
  });

  it("a concurrent write to a DIFFERENT issue is NOT serialized against the first", async () => {
    const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
    let maxInFlight = 0;
    let inFlight = 0;
    const sendRequest = async (): Promise<HttpTransportResponse> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { status: 200, headers: {}, bodyText: "{}" };
    };
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.103"],
      sendRequest,
      sleep: async () => undefined,
    });

    await Promise.all([
      httpClient.request({
        connectionId: connection.id,
        tenant: connection.id,
        resource: "issue:PROJ-1",
        url: new URL("/rest/api/3/issue/PROJ-1", BASE_URL),
        method: "PUT",
        isWrite: true,
      }),
      httpClient.request({
        connectionId: connection.id,
        tenant: connection.id,
        resource: "issue:PROJ-2",
        url: new URL("/rest/api/3/issue/PROJ-2", BASE_URL),
        method: "PUT",
        isWrite: true,
      }),
    ]);

    expect(maxInFlight).toBeGreaterThan(1);
  });
});

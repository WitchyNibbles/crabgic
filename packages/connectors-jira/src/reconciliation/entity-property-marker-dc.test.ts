import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import { createJiraDatacenterEntityPropertyMarkerReconciler } from "./entity-property-marker-dc.js";

const BASE_URL = "https://dc-marker-test.invalid";

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
    resolveHostAddresses: async () => ["203.0.113.230"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer x" }),
  };
}

describe("createJiraDatacenterEntityPropertyMarkerReconciler", () => {
  it("finds a single matching issue by marker via the DC search endpoint", async () => {
    const ctx = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          issues: [
            {
              id: "1",
              key: "PROJ-9",
              fields: { summary: "s", issuetype: { name: "Story" }, status: { name: "To Do" } },
            },
          ],
          startAt: 0,
          maxResults: 50,
          total: 1,
        }),
      },
    ]);
    const reconciler = createJiraDatacenterEntityPropertyMarkerReconciler(ctx, "issue");
    await expect(reconciler.findByMarker("m-1")).resolves.toBe("PROJ-9");
  });

  it("returns undefined (never a guess) for zero or ambiguous (>1) matches", async () => {
    const ctx = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({ issues: [], startAt: 0, maxResults: 50, total: 0 }),
      },
    ]);
    const reconciler = createJiraDatacenterEntityPropertyMarkerReconciler(ctx, "issue");
    await expect(reconciler.findByMarker("m-2")).resolves.toBeUndefined();
  });

  it("finds a matching comment by marker for the comment kind", async () => {
    const ctx = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          comments: [{ id: "50001", body: "x", properties: { marker: "m-3" }, updated: "r" }],
        }),
      },
    ]);
    const reconciler = createJiraDatacenterEntityPropertyMarkerReconciler(ctx, "comment", "PROJ-1");
    await expect(reconciler.findByMarker("m-3")).resolves.toBe("50001");
  });

  it("returns undefined on a transport failure — never surfaces as a thrown error", async () => {
    const ctx = buildCtx([{ status: 500, bodyText: "", fault: "boom" }]);
    const reconciler = createJiraDatacenterEntityPropertyMarkerReconciler(ctx, "issue");
    await expect(reconciler.findByMarker("m-4")).resolves.toBeUndefined();
  });
});

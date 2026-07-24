import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { createJiraEntityPropertyMarkerReconciler } from "./entity-property-marker.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

const BASE_URL = "https://marker-test.atlassian.invalid";

function buildCtx(responses: Parameters<typeof createFakeProviderTransport>[0]["responses"]) {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.20"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  return { ctx, fake };
}

describe("createJiraEntityPropertyMarkerReconciler — issue markers", () => {
  it("returns the found issue key when the marker search yields exactly one issue", async () => {
    const { ctx } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          issues: [
            {
              id: "1",
              key: "PROJ-42",
              fields: { summary: "s", issuetype: { name: "Task" }, status: { name: "To Do" } },
            },
          ],
        }),
      },
    ]);
    const reconciler = createJiraEntityPropertyMarkerReconciler(ctx, "issue");

    const found = await reconciler.findByMarker("marker-abc");

    expect(found).toBe("PROJ-42");
  });

  it("returns undefined (never a guess) when the marker search yields no issue", async () => {
    const { ctx } = buildCtx([{ status: 200, bodyText: JSON.stringify({ issues: [] }) }]);
    const reconciler = createJiraEntityPropertyMarkerReconciler(ctx, "issue");

    const found = await reconciler.findByMarker("marker-missing");

    expect(found).toBeUndefined();
  });

  it("returns undefined (never a guess) when the marker search ambiguously yields more than one issue", async () => {
    const { ctx } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          issues: [
            {
              id: "1",
              key: "PROJ-1",
              fields: { summary: "s", issuetype: { name: "Task" }, status: { name: "To Do" } },
            },
            {
              id: "2",
              key: "PROJ-2",
              fields: { summary: "s", issuetype: { name: "Task" }, status: { name: "To Do" } },
            },
          ],
        }),
      },
    ]);
    const reconciler = createJiraEntityPropertyMarkerReconciler(ctx, "issue");

    const found = await reconciler.findByMarker("marker-ambiguous");

    expect(found).toBeUndefined();
  });

  it("returns undefined (never throws) on a transport failure — treated as unresolved, never a guessed duplicate", async () => {
    const { ctx } = buildCtx([{ status: 500, bodyText: "" }]);
    const reconciler = createJiraEntityPropertyMarkerReconciler(ctx, "issue");

    const found = await reconciler.findByMarker("marker-error");

    expect(found).toBeUndefined();
  });
});

describe("createJiraEntityPropertyMarkerReconciler — comment markers", () => {
  it("searches an issue's comments for a matching entity-property marker", async () => {
    const { ctx } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          comments: [
            { id: "10", body: {}, properties: { marker: "other" } },
            { id: "11", body: {}, properties: { marker: "target-marker" } },
          ],
        }),
      },
    ]);
    const reconciler = createJiraEntityPropertyMarkerReconciler(ctx, "comment", "PROJ-1");

    const found = await reconciler.findByMarker("target-marker");

    expect(found).toBe("11");
  });
});

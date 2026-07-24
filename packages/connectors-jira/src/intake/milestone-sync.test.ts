import { describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";
import { planMilestoneSync } from "./milestone-sync.js";

const BASE_URL = "https://milestone-sync-test.atlassian.invalid";
const ENVELOPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 200, bodyText: JSON.stringify(body) };
}

function buildDeps(responses: readonly FakeProviderScriptEntry[]) {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.80"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  const resourceClient = createJiraResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry: new JiraPlanPayloadRegistry(),
  });
  return { resourceClient };
}

function baseInput(overrides: Partial<Parameters<typeof planMilestoneSync>[0]> = {}) {
  return {
    issueKey: "PROJ-1",
    kind: "start" as const,
    outcome: "kicked off implementation",
    evidence: "https://ci.example.invalid/run/1",
    risk: "none",
    next: "implement core module",
    ref: "PROJ-1",
    envelopeId: ENVELOPE_ID,
    ...overrides,
  };
}

describe("planMilestoneSync — no existing dedup comment (create path)", () => {
  it("creates exactly one comment plan carrying a per-(issue,kind) marker", async () => {
    const { resourceClient } = buildDeps([]);
    const outcome = await planMilestoneSync(baseInput(), {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.commentAction).toBe("create");
      expect(outcome.plan.action).toBe("comment.create");
      expect(outcome.marker).toBe("milestone-sync:PROJ-1:start");
      expect(outcome.journalEntry.milestoneKind).toBe("start");
    }
  });
});

describe("planMilestoneSync — an existing dedup comment (edit-in-place path)", () => {
  it("updates the existing comment rather than creating a second one", async () => {
    const { resourceClient } = buildDeps([
      ok({
        comments: [
          {
            id: "77",
            body: {},
            properties: { marker: "milestone-sync:PROJ-1:start" },
            updated: "rev-77",
          },
        ],
      }),
    ]);
    const outcome = await planMilestoneSync(baseInput(), {
      resourceClient,
      commentMarkerReconciler: {
        findByMarker: async (marker) =>
          marker === "milestone-sync:PROJ-1:start" ? "77" : undefined,
      },
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status === "planned") {
      expect(outcome.commentAction).toBe("update");
      expect(outcome.plan.action).toBe("comment.update");
      expect(outcome.plan.canonicalTarget).toBe("issue:PROJ-1:comment:77");
    }
  });
});

describe("planMilestoneSync — distinct milestone kinds never share a marker", () => {
  it("start/material_blocker/verified_completion each get their own marker", async () => {
    const { resourceClient } = buildDeps([]);
    const start = await planMilestoneSync(baseInput({ kind: "start" }), {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    });
    const blocker = await planMilestoneSync(baseInput({ kind: "material_blocker" }), {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    });
    const completion = await planMilestoneSync(baseInput({ kind: "verified_completion" }), {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    });

    const markers = [start, blocker, completion].map((o) =>
      o.status === "planned" ? o.marker : undefined,
    );
    expect(new Set(markers).size).toBe(3);
  });
});

describe("planMilestoneSync — policy enforcement", () => {
  it("blocks (never creates a plan) when the rendered comment cannot pass lint even after one regeneration", async () => {
    const { resourceClient } = buildDeps([]);
    const outcome = await planMilestoneSync(baseInput({ outcome: "x".repeat(2000) }), {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    });

    expect(outcome.status).toBe("blocked");
  });
});

import { describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@crabgic/gateway";
import { buildExternalConnection } from "@crabgic/testkit";
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

describe("planMilestoneSync — revision polling across two milestone polls (18:139 integration fixture)", () => {
  const CONNECTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function issueBody(updated: string, description: string): unknown {
    return {
      id: "10001",
      key: "PROJ-1",
      fields: {
        summary: "Do the thing",
        issuetype: { name: "Task" },
        status: { name: "In Progress" },
        updated,
        description,
      },
    };
  }

  const noComment = { findByMarker: async () => undefined };

  it("detects a seeded material remote edit between two polls and returns the amendment-review signal", async () => {
    // The integration channel roadmap/18:139 names: two REAL `issues.get`
    // reads through `createJiraResourceClient` over `createFakeProviderTransport`
    // (buildDeps above), diffed by the REAL `compareRemoteResourceRevisions`
    // from the milestone path — not two hand-built `buildRemoteResource` stamps.
    const { resourceClient } = buildDeps([
      ok(issueBody("rev-1", "v1")),
      ok(issueBody("rev-2", "v2 - edited remotely")),
    ]);

    const first = await planMilestoneSync(
      baseInput({ revisionPoll: { externalConnectionId: CONNECTION_ID } }),
      { resourceClient, commentMarkerReconciler: noComment },
    );
    expect(first.status).toBe("planned");
    if (first.status !== "planned") return;
    // First poll: no previous stamp, so no signal can be produced.
    expect(first.revisionPoll?.signal).toBeUndefined();
    expect(first.revisionPoll?.currentStamp.revision).toBe("rev-1");
    expect(first.revisionPoll?.fieldSnapshot["description"]).toBe("v1");
    const previousStamp = first.revisionPoll?.currentStamp;
    if (previousStamp === undefined) throw new Error("first poll produced no stamp");

    const second = await planMilestoneSync(
      baseInput({
        kind: "material_blocker",
        revisionPoll: { externalConnectionId: CONNECTION_ID, previousStamp },
      }),
      { resourceClient, commentMarkerReconciler: noComment },
    );
    expect(second.status).toBe("planned");
    if (second.status !== "planned") return;
    expect(second.revisionPoll?.signal).toEqual({
      material: true,
      previousRevision: "rev-1",
      currentRevision: "rev-2",
    });
    // The before/after projection 21's `buildJiraFieldDiffs` consumes.
    expect(second.revisionPoll?.fieldSnapshot["description"]).toBe("v2 - edited remotely");
    expect(second.revisionPoll?.fieldSnapshot["summary"]).toBe("Do the thing");
    // The revision timestamp is destructured out of `JiraIssue.fields`
    // upstream, so it can never masquerade as a tracked-field edit.
    expect(second.revisionPoll?.fieldSnapshot["updated"]).toBeUndefined();
  });

  it("control: an unchanged remote revision across two polls is non-material", async () => {
    // Distinct SHAPE, not a negated string: `MaterialChangeSignal` is a
    // discriminated union, so `{material:false}` carries no revision members
    // at all and cannot be satisfied by any part of the positive case.
    const { resourceClient } = buildDeps([
      ok(issueBody("rev-1", "v1")),
      ok(issueBody("rev-1", "v1")),
    ]);

    const first = await planMilestoneSync(
      baseInput({ revisionPoll: { externalConnectionId: CONNECTION_ID } }),
      { resourceClient, commentMarkerReconciler: noComment },
    );
    expect(first.status).toBe("planned");
    if (first.status !== "planned") return;
    const previousStamp = first.revisionPoll?.currentStamp;
    if (previousStamp === undefined) throw new Error("first poll produced no stamp");

    const second = await planMilestoneSync(
      baseInput({
        kind: "material_blocker",
        revisionPoll: { externalConnectionId: CONNECTION_ID, previousStamp },
      }),
      { resourceClient, commentMarkerReconciler: noComment },
    );
    expect(second.status).toBe("planned");
    if (second.status !== "planned") return;
    expect(second.revisionPoll?.signal).toEqual({ material: false });
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

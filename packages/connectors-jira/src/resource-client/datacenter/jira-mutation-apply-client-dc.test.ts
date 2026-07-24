import { describe, expect, it } from "vitest";
import { ConnectorError, CURRENT_SCHEMA_VERSION, type RemoteMutationPlan } from "@eo/contracts";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { toADF } from "@eo/renderer";
import { buildExternalConnection } from "@eo/testkit";
import { AttachmentStagingRegistry } from "../../attachments/attachment-staging.js";
import { JiraPlanPayloadRegistry } from "../plan-payload-registry.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";
import { createJiraDatacenterMutationApplyClient } from "./jira-mutation-apply-client-dc.js";

const VERIFY_BASE_URL = "https://dc-verify-test.invalid";

function buildVerifyCtx(
  responses: Parameters<typeof createFakeProviderTransport>[0]["responses"],
): JiraDatacenterHttpContext {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: VERIFY_BASE_URL,
  });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(VERIFY_BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.199"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer x" }),
  };
}

const ENVELOPE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function buildPlan(overrides: Partial<RemoteMutationPlan>): RemoteMutationPlan {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    externalConnectionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    tenant: "PROJ",
    canonicalTarget: "issue:PROJ-1",
    action: "issue.create",
    redactedDiff: "create Story in PROJ",
    desiredStateHash: "sha256:x",
    idempotencyKey: "issue.create:PROJ:x",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: ENVELOPE_ID,
    ...overrides,
  };
}

function noopCtx(): JiraDatacenterHttpContext {
  return {
    connection: undefined as never, // unused by buildRequest/parseResponse in these unit tests
    httpClient: undefined as never,
    authHeaderProvider: async () => ({ authorization: "Bearer x" }),
  };
}

describe("createJiraDatacenterMutationApplyClient — buildRequest", () => {
  it("builds a POST to /rest/api/2/issue (never /rest/api/3/) with the ADF summary converted to wiki markup", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.create" });
    payloadRegistry.put(plan.id, {
      projectKeyOrId: "PROJ",
      issueType: "Story",
      summaryAdf: toADF("**Bold** summary"),
    });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    const request = client.buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issue");
    expect(request.url.pathname).not.toContain("/rest/api/3/");
    expect(request.method).toBe("POST");
    const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
    expect(body["summaryAdf"]).toBe("*Bold* summary");
  });

  it("rejects an unsafe ADF payload (javascript: href) at the apply boundary, mirroring Cloud's defense-in-depth", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.create" });
    payloadRegistry.put(plan.id, {
      projectKeyOrId: "PROJ",
      issueType: "Story",
      summaryAdf: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "click",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
    });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    expect(() => client.buildRequest(plan)).toThrow(ConnectorError);
  });

  it("MINOR-1 (adversarial-review): attributes an unsafe-ADF apply-boundary rejection to jira-datacenter, never jira-cloud", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.create" });
    payloadRegistry.put(plan.id, {
      projectKeyOrId: "PROJ",
      issueType: "Story",
      summaryAdf: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "click",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
    });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    try {
      client.buildRequest(plan);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).provider).toBe("jira-datacenter");
    }
  });

  it("builds a PUT to /rest/api/2/issue/:key for issue.update with description converted to wiki markup", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({
      action: "issue.update",
      canonicalTarget: "issue:PROJ-2",
      expectedRemoteRevision: "rev-1",
    });
    payloadRegistry.put(plan.id, { description: toADF("a *bold* description") });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const request = client.buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issue/PROJ-2");
    expect(request.method).toBe("PUT");
    const body = JSON.parse(request.body ?? "{}") as { fields: Record<string, unknown> };
    expect(body.fields["description"]).toBe("a _bold_ description");
  });

  it("builds a POST to /rest/api/2/issue/:key/comment for comment.create with bodyAdf converted to wiki markup", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({
      action: "comment.create",
      canonicalTarget: "issue:PROJ-2:comment",
      idempotencyKey: "comment.create:PROJ-2:m-1",
    });
    payloadRegistry.put(plan.id, { bodyAdf: toADF("a comment with `code`"), marker: "m-1" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const request = client.buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issue/PROJ-2/comment");
    const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
    expect(body["body"]).toBe("a comment with {{code}}");
    expect((body["properties"] as Array<{ value: { marker: string } }>)[0]?.value.marker).toBe(
      plan.idempotencyKey,
    );
  });

  it("builds Agile paths for board/sprint actions, identical to Cloud", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({
      action: "sprint.start",
      canonicalTarget: "sprint:10",
      expectedRemoteRevision: "r",
    });
    payloadRegistry.put(plan.id, { state: "active" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const request = client.buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/sprint/10");
  });

  it("rejects a plan carrying a forged out-of-scope action before building any request", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.delete" as never });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    expect(() => client.buildRequest(plan)).toThrow(ConnectorError);
  });
});

describe("createJiraDatacenterMutationApplyClient — buildRequest (remaining actions)", () => {
  function buildClient(payloadRegistry: JiraPlanPayloadRegistry) {
    return createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
  }

  it("issue.link -> POST /rest/api/2/issueLink", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.link" });
    payloadRegistry.put(plan.id, {
      linkType: "relates to",
      outwardIssueKey: "PROJ-1",
      inwardIssueKey: "PROJ-2",
    });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issueLink");
    expect(request.method).toBe("POST");
  });

  it("issue.rank -> PUT /rest/agile/1.0/issue/rank", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.rank" });
    payloadRegistry.put(plan.id, { issueKeys: ["PROJ-1"] });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/issue/rank");
    expect(request.method).toBe("PUT");
  });

  it("issue.bulkUpdate -> POST /rest/api/2/bulk/issues/fields", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.bulkUpdate" });
    payloadRegistry.put(plan.id, { issueKeys: ["PROJ-1"], fields: {} });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/bulk/issues/fields");
  });

  it("issue.bulkTransition -> POST /rest/api/2/bulk/issues/transition", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.bulkTransition" });
    payloadRegistry.put(plan.id, { issueKeys: ["PROJ-1"], transitionId: "31" });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/bulk/issues/transition");
  });

  it("worklog.create -> POST /rest/api/2/issue/:key/worklog", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "worklog.create", canonicalTarget: "issue:PROJ-1:worklog" });
    payloadRegistry.put(plan.id, { timeSpentSeconds: 60 });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issue/PROJ-1/worklog");
  });

  it("attachment.upload -> POST /rest/api/2/issue/:key/attachments, consuming the staged bytes", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const attachmentStaging = new AttachmentStagingRegistry();
    const stagingId = attachmentStaging.stage({
      filename: "f.txt",
      mimeType: "text/plain",
      content: Buffer.from("bytes"),
    });
    const plan = buildPlan({
      action: "attachment.upload",
      canonicalTarget: "issue:PROJ-1:attachment",
    });
    payloadRegistry.put(plan.id, { stagingId, filename: "f.txt", sizeBytes: 5 });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: { ...noopCtx(), connection: { baseUrl: "https://dc.invalid" } as never },
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const request = client.buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issue/PROJ-1/attachments");
  });

  it("board.create -> POST /rest/agile/1.0/board", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "board.create" });
    payloadRegistry.put(plan.id, { name: "B", type: "scrum", projectKeyOrId: "PROJ" });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/board");
  });

  it("board.update -> PUT /rest/agile/1.0/board/:id", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "board.update", canonicalTarget: "board:1" });
    payloadRegistry.put(plan.id, { name: "New" });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/board/1");
  });

  it("sprint.create -> POST /rest/agile/1.0/sprint", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "sprint.create" });
    payloadRegistry.put(plan.id, { boardId: 1, name: "S" });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/sprint");
  });

  it("sprint.complete -> PUT /rest/agile/1.0/sprint/:id", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "sprint.complete", canonicalTarget: "sprint:10" });
    payloadRegistry.put(plan.id, { state: "closed" });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/sprint/10");
  });

  it("sprint.moveIssues -> POST /rest/agile/1.0/sprint/:id/issue", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "sprint.moveIssues", canonicalTarget: "sprint:10" });
    payloadRegistry.put(plan.id, { issueKeys: ["PROJ-1"] });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/agile/1.0/sprint/10/issue");
  });

  it("comment.update -> PUT /rest/api/2/issue/:key/comment/:id", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({
      action: "comment.update",
      canonicalTarget: "issue:PROJ-1:comment:50001",
      expectedRemoteRevision: "rev-1",
    });
    payloadRegistry.put(plan.id, { bodyAdf: toADF("updated") });
    const request = buildClient(payloadRegistry).buildRequest(plan);
    expect(request.url.pathname).toBe("/rest/api/2/issue/PROJ-1/comment/50001");
  });
});

describe("createJiraDatacenterMutationApplyClient — parseResponse (remaining branches)", () => {
  it("returns the plan's desiredStateHash for an action with no stable revision field (e.g. issue.update)", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.update", desiredStateHash: "sha256:abc" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const result = client.parseResponse(plan, { status: 204, headers: {}, bodyText: "" });
    expect(result.appliedRevision).toBe("sha256:abc");
  });

  it("extracts the attachment id from an array-shaped response body", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "attachment.upload" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const result = client.parseResponse(plan, {
      status: 200,
      headers: {},
      bodyText: JSON.stringify([{ id: "40001" }]),
    });
    expect(result.appliedRevision).toBe("40001");
  });
});

describe("createJiraDatacenterMutationApplyClient — reconcileAmbiguous (remaining branches)", () => {
  it("resolves via the comment marker reconciler for comment.create", async () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "comment.create", canonicalTarget: "issue:PROJ-1:comment" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => "50001" }),
    });
    const result = await client.reconcileAmbiguous?.(plan, new Error("timeout"));
    expect(result?.appliedRevision).toBe("50001");
  });

  it("returns undefined (genuinely unknown) for an action with no marker-based reconciliation (e.g. worklog.create)", async () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "worklog.create" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => "should-never-be-used" },
      commentMarkerReconciler: () => ({ findByMarker: async () => "should-never-be-used" }),
    });
    const result = await client.reconcileAmbiguous?.(plan, new Error("timeout"));
    expect(result).toBeUndefined();
  });
});

describe("createJiraDatacenterMutationApplyClient — verify (via createJiraDatacenterResourceClient reads)", () => {
  it("returns true (liveness) for an action with no dedicated read-back handle (e.g. issue.create)", async () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.create" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    await expect(client.verify?.(plan, { appliedRevision: "PROJ-1" })).resolves.toBe(true);
  });

  it("issue.update/transition: reads back the issue and confirms the revision actually changed", async () => {
    const ctx = buildVerifyCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          id: "1",
          key: "PROJ-1",
          fields: {
            summary: "s",
            issuetype: { name: "Story" },
            status: { name: "Done" },
            updated: "rev-after",
          },
        }),
      },
    ]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.transition", expectedRemoteRevision: "rev-before" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    await expect(client.verify?.(plan, { appliedRevision: "x" })).resolves.toBe(true);
  });

  it("sprint.start/sprint.complete: reads back the sprint state", async () => {
    const ctxStart = buildVerifyCtx([
      {
        status: 200,
        bodyText: JSON.stringify({ id: 10, name: "S", state: "active", originBoardId: 1 }),
      },
    ]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const startPlan = buildPlan({ action: "sprint.start", canonicalTarget: "sprint:10" });
    const startClient = createJiraDatacenterMutationApplyClient({
      ctx: ctxStart,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    await expect(startClient.verify?.(startPlan, { appliedRevision: "x" })).resolves.toBe(true);

    const ctxComplete = buildVerifyCtx([
      {
        status: 200,
        bodyText: JSON.stringify({ id: 10, name: "S", state: "closed", originBoardId: 1 }),
      },
    ]);
    const completePlan = buildPlan({ action: "sprint.complete", canonicalTarget: "sprint:10" });
    const completeClient = createJiraDatacenterMutationApplyClient({
      ctx: ctxComplete,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    await expect(completeClient.verify?.(completePlan, { appliedRevision: "x" })).resolves.toBe(
      true,
    );
  });

  it("board.update: a successful read-back is treated as verified", async () => {
    const ctx = buildVerifyCtx([
      { status: 200, bodyText: JSON.stringify({ id: 1, name: "Board", type: "scrum" }) },
    ]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "board.update", canonicalTarget: "board:1" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    await expect(client.verify?.(plan, { appliedRevision: "x" })).resolves.toBe(true);
  });

  it("returns false (never throws) when the read-back call itself fails", async () => {
    const ctx = buildVerifyCtx([{ status: 500, bodyText: "" }]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.update", expectedRemoteRevision: "rev-1" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    await expect(client.verify?.(plan, { appliedRevision: "x" })).resolves.toBe(false);
  });
});

describe("createJiraDatacenterMutationApplyClient — parseResponse", () => {
  it("extracts the created issue key from a 201 response", () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.create" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const result = client.parseResponse(plan, {
      status: 201,
      headers: {},
      bodyText: JSON.stringify({ key: "PROJ-9" }),
    });
    expect(result.appliedRevision).toBe("PROJ-9");
  });
});

describe("createJiraDatacenterMutationApplyClient — reconcileAmbiguous", () => {
  it("resolves via the issue marker reconciler for issue.create", async () => {
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const plan = buildPlan({ action: "issue.create" });
    const client = createJiraDatacenterMutationApplyClient({
      ctx: noopCtx(),
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => "PROJ-9" },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const result = await client.reconcileAmbiguous?.(plan, new Error("timeout"));
    expect(result?.appliedRevision).toBe("PROJ-9");
  });
});

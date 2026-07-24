import { describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import { ConnectorError, RemoteMutationPlanSchema, type RemoteMutationPlan } from "@eo/contracts";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import {
  createJiraMutationApplyClient,
  type JiraMutationApplyDeps,
} from "./jira-mutation-apply-client.js";
import { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import type { JiraHttpContext } from "./http-read-helper.js";

const BASE_URL = "https://apply-client-test.atlassian.invalid";
const ENVELOPE_ID = "22222222-2222-4222-8222-222222222222";

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 200, bodyText: JSON.stringify(body) };
}

function buildDeps(responses: readonly FakeProviderScriptEntry[]): {
  deps: JiraMutationApplyDeps;
  calls: readonly { readonly method: string; readonly url: string }[];
} {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.30"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  return {
    deps: {
      ctx,
      payloadRegistry: new JiraPlanPayloadRegistry(),
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    },
    calls: fake.calls,
  };
}

function buildPlan(overrides: Partial<RemoteMutationPlan>): RemoteMutationPlan {
  return RemoteMutationPlanSchema.parse({
    schemaVersion: 1,
    id: "33333333-3333-4333-8333-333333333333",
    externalConnectionId: "44444444-4444-4444-8444-444444444444",
    tenant: "tenant-a",
    canonicalTarget: "issue:PROJ-1",
    action: "issue.update",
    redactedDiff: "diff",
    desiredStateHash: "sha256:x",
    idempotencyKey: "op-1",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: ENVELOPE_ID,
    ...overrides,
  });
}

describe("createJiraMutationApplyClient — buildRequest", () => {
  it("issue.create POSTs to /rest/api/3/issue with the staged payload + an entity-property marker", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.create", canonicalTarget: "project:PROJ:new-issue" });
    deps.payloadRegistry.put(plan.id, {
      fields: { summary: "hi" },
      summaryAdf: { type: "doc", version: 1, content: [] },
    });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    expect(spec.method).toBe("POST");
    expect(spec.url.pathname).toBe("/rest/api/3/issue");
    const body = JSON.parse(spec.body ?? "{}");
    expect(body.properties[0].value.marker).toBe("op-1");
  });

  it("issue.update PUTs to the issue's endpoint with a precondition when expectedRemoteRevision is set", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.update", expectedRemoteRevision: "rev-1" });
    deps.payloadRegistry.put(plan.id, { summary: "new" });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    expect(spec.method).toBe("PUT");
    expect(spec.url.pathname).toBe("/rest/api/3/issue/PROJ-1");
    expect(spec.hasPrecondition).toBe(true);
  });

  it("issue.transition POSTs to the transitions sub-resource", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.transition" });
    deps.payloadRegistry.put(plan.id, { transitionId: "31" });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    expect(spec.url.pathname).toBe("/rest/api/3/issue/PROJ-1/transitions");
    expect(JSON.parse(spec.body ?? "{}")).toEqual({ transition: { id: "31" } });
  });

  it("attachment.upload resolves the staged bytes through the payload registry + attachment staging registry, base64-encoded", () => {
    const { deps } = buildDeps([]);
    const stagingId = deps.attachmentStaging.stage({
      filename: "report.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("pdf-bytes"),
    });
    const plan = buildPlan({
      action: "attachment.upload",
      canonicalTarget: "issue:PROJ-1:attachment",
    });
    deps.payloadRegistry.put(plan.id, { stagingId, filename: "report.pdf", sizeBytes: 9 });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    expect(spec.url.pathname).toBe("/rest/api/3/issue/PROJ-1/attachments");
    const body = JSON.parse(spec.body ?? "{}");
    expect(Buffer.from(body.contentBase64, "base64").toString()).toBe("pdf-bytes");
  });

  it("rejects a plan carrying a forged out-of-scope action before building any request", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.delete" as RemoteMutationPlan["action"] });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).toThrow(ConnectorError);
  });

  // HIGH H1 (adversarial-review) apply-boundary enforcement: even a plan
  // constructed OUTSIDE the typed `plan*` builders (e.g. directly via
  // `buildJiraMutationPlan`, or a tampered payload-registry entry) must
  // never get an unsafe ADF document past `buildRequest` — this is
  // deliberately independent of, and redundant with, the plan-build-time
  // guard in `./issue-plans.ts` / `./comment-worklog-attachment-plans.ts`.
  const unsafeHrefAdf = {
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
  };
  const secretBearingAdf = {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "AKIAABCDEFGHIJKLMNOP" }] }],
  };

  it("buildRequest rejects an unsafe (javascript:-href) ADF comment.create payload at the apply boundary", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "comment.create", canonicalTarget: "issue:PROJ-1:comment" });
    deps.payloadRegistry.put(plan.id, { bodyAdf: unsafeHrefAdf, marker: "m-1" });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).toThrow(ConnectorError);
  });

  it("buildRequest rejects a secret-bearing ADF comment.create payload at the apply boundary", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "comment.create", canonicalTarget: "issue:PROJ-1:comment" });
    deps.payloadRegistry.put(plan.id, { bodyAdf: secretBearingAdf, marker: "m-1" });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).toThrow(ConnectorError);
  });

  // MEDIUM M1 (adversarial-review): the stamped entity-property marker
  // MUST equal what `reconcileAmbiguous` searches by (`plan.idempotencyKey`
  // — see the `reconcileAmbiguous` test below) — otherwise a mid-POST
  // timeout on a comment that DID land can never be found again.
  it("comment.create stamps plan.idempotencyKey (never the bare caller-supplied marker) as the entity property value", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({
      action: "comment.create",
      canonicalTarget: "issue:PROJ-1:comment",
      idempotencyKey: "comment.create:PROJ-1:milestone-sync:PROJ-1:start",
    });
    deps.payloadRegistry.put(plan.id, {
      bodyAdf: { type: "doc", version: 1, content: [] },
      marker: "milestone-sync:PROJ-1:start",
    });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    const body = JSON.parse(spec.body ?? "{}") as { properties: { value: { marker: string } }[] };
    expect(body.properties[0]?.value.marker).toBe(plan.idempotencyKey);
    expect(body.properties[0]?.value.marker).not.toBe("milestone-sync:PROJ-1:start");
  });

  it("buildRequest rejects an unsafe ADF comment.update payload at the apply boundary", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({
      action: "comment.update",
      canonicalTarget: "issue:PROJ-1:comment:10",
    });
    deps.payloadRegistry.put(plan.id, { bodyAdf: unsafeHrefAdf });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).toThrow(ConnectorError);
  });

  it("buildRequest rejects an unsafe ADF issue.create summaryAdf payload at the apply boundary", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.create", canonicalTarget: "project:PROJ:new-issue" });
    deps.payloadRegistry.put(plan.id, {
      projectKeyOrId: "PROJ",
      issueType: "Task",
      summaryAdf: unsafeHrefAdf,
    });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).toThrow(ConnectorError);
  });

  it("buildRequest rejects an unsafe ADF issue.update fields.description payload at the apply boundary", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.update" });
    deps.payloadRegistry.put(plan.id, { description: secretBearingAdf });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).toThrow(ConnectorError);
  });

  it("buildRequest still allows an issue.update with no description field at all", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.update" });
    deps.payloadRegistry.put(plan.id, { summary: "no description here" });

    expect(() => createJiraMutationApplyClient(deps).buildRequest(plan)).not.toThrow();
  });

  it.each([
    ["issue.link", "issue:PROJ-1", "POST", "/rest/api/3/issueLink"],
    ["issue.rank", "board:1", "PUT", "/rest/agile/1.0/issue/rank"],
    ["issue.bulkUpdate", "bulk:PROJ-1,PROJ-2", "POST", "/rest/api/3/bulk/issues/fields"],
    ["issue.bulkTransition", "bulk:PROJ-1,PROJ-2", "POST", "/rest/api/3/bulk/issues/transition"],
    ["board.create", "project:PROJ:new-board", "POST", "/rest/agile/1.0/board"],
    ["board.update", "board:1", "PUT", "/rest/agile/1.0/board/1"],
    ["sprint.create", "board:1:new-sprint", "POST", "/rest/agile/1.0/sprint"],
    ["sprint.moveIssues", "sprint:5", "POST", "/rest/agile/1.0/sprint/5/issue"],
    ["worklog.create", "issue:PROJ-1:worklog", "POST", "/rest/api/3/issue/PROJ-1/worklog"],
  ] as const)(
    "%s builds the expected %s %s request",
    (action, canonicalTarget, method, pathname) => {
      const { deps } = buildDeps([]);
      const plan = buildPlan({ action, canonicalTarget });
      deps.payloadRegistry.put(plan.id, {});

      const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

      expect(spec.method).toBe(method);
      expect(spec.url.pathname).toBe(pathname);
    },
  );

  it("comment.update PUTs to the comment's own sub-resource with a precondition", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({
      action: "comment.update",
      canonicalTarget: "issue:PROJ-1:comment:10",
      expectedRemoteRevision: "rev-1",
    });
    deps.payloadRegistry.put(plan.id, { bodyAdf: { type: "doc", version: 1, content: [] } });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    expect(spec.url.pathname).toBe("/rest/api/3/issue/PROJ-1/comment/10");
    expect(spec.hasPrecondition).toBe(true);
  });

  it("sprint.start PUTs with state=active", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "sprint.start", canonicalTarget: "sprint:5" });
    deps.payloadRegistry.put(plan.id, { state: "active" });

    const spec = createJiraMutationApplyClient(deps).buildRequest(plan);

    expect(spec.url.pathname).toBe("/rest/agile/1.0/sprint/5");
  });
});

describe("createJiraMutationApplyClient — parseResponse", () => {
  it("extracts the created issue key as appliedRevision for issue.create", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.create" });
    const client = createJiraMutationApplyClient(deps);

    const result = client.parseResponse(plan, {
      status: 201,
      headers: {},
      bodyText: JSON.stringify({ id: "10001", key: "PROJ-99" }),
    });

    expect(result.appliedRevision).toBe("PROJ-99");
  });

  it("falls back to the plan's own content hash when the response carries no stable id (e.g. a 204 update)", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.update", desiredStateHash: "sha256:abc" });
    const client = createJiraMutationApplyClient(deps);

    const result = client.parseResponse(plan, { status: 204, headers: {}, bodyText: "" });

    expect(result.appliedRevision).toBe("sha256:abc");
  });

  it("extracts a numeric id (board/sprint create) as a string appliedRevision", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "board.create" });
    const client = createJiraMutationApplyClient(deps);

    const result = client.parseResponse(plan, {
      status: 201,
      headers: {},
      bodyText: JSON.stringify({ id: 1 }),
    });

    expect(result.appliedRevision).toBe("1");
  });

  it("attachment.upload falls back to a sentinel when the response carries no id at all", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "attachment.upload" });
    const client = createJiraMutationApplyClient(deps);

    const result = client.parseResponse(plan, {
      status: 200,
      headers: {},
      bodyText: JSON.stringify([{}]),
    });

    expect(result.appliedRevision).toContain("uploaded");
  });

  it("falls back to a sentinel for issue.create when the response has no key/id at all", () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.create" });
    const client = createJiraMutationApplyClient(deps);

    const result = client.parseResponse(plan, { status: 201, headers: {}, bodyText: "{}" });

    expect(result.appliedRevision).toContain("created");
  });
});

describe("createJiraMutationApplyClient — verify", () => {
  it("issue.update verifies via read-back: the issue's revision must differ from the pre-write expectedRemoteRevision", async () => {
    const { deps } = buildDeps([
      ok({
        id: "1",
        key: "PROJ-1",
        fields: {
          summary: "s",
          issuetype: { name: "Task" },
          status: { name: "Done" },
          updated: "new-revision",
        },
      }),
    ]);
    const plan = buildPlan({ action: "issue.update", expectedRemoteRevision: "old-revision" });
    const client = createJiraMutationApplyClient(deps);

    const verified = await client.verify?.(plan, { appliedRevision: "x" });

    expect(verified).toBe(true);
  });

  it("defaults to true for actions with no cheap read-back handle (e.g. comment.create)", async () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "comment.create", canonicalTarget: "issue:PROJ-1:comment" });
    const client = createJiraMutationApplyClient(deps);

    const verified = await client.verify?.(plan, { appliedRevision: "x" });

    expect(verified).toBe(true);
  });

  it("returns false when the read-back itself fails", async () => {
    const { deps } = buildDeps([{ status: 500, bodyText: "" }]);
    const plan = buildPlan({ action: "issue.update", expectedRemoteRevision: "old-revision" });
    const client = createJiraMutationApplyClient(deps);

    const verified = await client.verify?.(plan, { appliedRevision: "x" });

    expect(verified).toBe(false);
  });

  it("issue.update with no expectedRemoteRevision at all is trivially verified", async () => {
    const { deps } = buildDeps([
      ok({
        id: "1",
        key: "PROJ-1",
        fields: { summary: "s", issuetype: { name: "Task" }, status: { name: "To Do" } },
      }),
    ]);
    const plan = buildPlan({ action: "issue.update" });
    const client = createJiraMutationApplyClient(deps);

    const verified = await client.verify?.(plan, { appliedRevision: "x" });

    expect(verified).toBe(true);
  });

  it("sprint.start / sprint.complete verify against the sprint's own state field", async () => {
    const { deps: startDeps } = buildDeps([
      ok({ id: 5, name: "S", state: "active", originBoardId: 1 }),
    ]);
    const startPlan = buildPlan({ action: "sprint.start", canonicalTarget: "sprint:5" });
    expect(
      await createJiraMutationApplyClient(startDeps).verify?.(startPlan, { appliedRevision: "x" }),
    ).toBe(true);

    const { deps: completeDeps } = buildDeps([
      ok({ id: 5, name: "S", state: "closed", originBoardId: 1 }),
    ]);
    const completePlan = buildPlan({ action: "sprint.complete", canonicalTarget: "sprint:5" });
    expect(
      await createJiraMutationApplyClient(completeDeps).verify?.(completePlan, {
        appliedRevision: "x",
      }),
    ).toBe(true);
  });

  it("board.update verifies via a read-back existence check", async () => {
    const { deps } = buildDeps([ok({ id: 1, name: "B", type: "scrum" })]);
    const plan = buildPlan({ action: "board.update", canonicalTarget: "board:1" });

    const verified = await createJiraMutationApplyClient(deps).verify?.(plan, {
      appliedRevision: "x",
    });

    expect(verified).toBe(true);
  });
});

describe("createJiraMutationApplyClient — reconcileAmbiguous", () => {
  it("issue.create resolves via the issue marker reconciler", async () => {
    const { deps } = buildDeps([]);
    const withReconciler: JiraMutationApplyDeps = {
      ...deps,
      issueMarkerReconciler: {
        findByMarker: async (marker) => (marker === "op-1" ? "PROJ-7" : undefined),
      },
    };
    const plan = buildPlan({ action: "issue.create", idempotencyKey: "op-1" });
    const client = createJiraMutationApplyClient(withReconciler);

    const reconciled = await client.reconcileAmbiguous?.(plan, new Error("timeout"));

    expect(reconciled).toEqual({ appliedRevision: "PROJ-7" });
  });

  it("an action with no reconciliation mapping resolves to undefined (fails closed)", async () => {
    const { deps } = buildDeps([]);
    const plan = buildPlan({ action: "issue.update" });
    const client = createJiraMutationApplyClient(deps);

    const reconciled = await client.reconcileAmbiguous?.(plan, new Error("timeout"));

    expect(reconciled).toBeUndefined();
  });
});

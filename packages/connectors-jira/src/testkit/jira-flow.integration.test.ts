import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  createFakeProviderTransport,
  executeMutationPlan,
  preconditionFailedResponse,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import { toADF } from "@eo/renderer";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraMutationApplyClient } from "../resource-client/jira-mutation-apply-client.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

/**
 * roadmap/18 §Exit criteria: "Plan's Jira flow passes on fakes +
 * cassettes: board → sprint → epic → issue → link → worklog →
 * attachment; ADF/text conversion; transitions; concurrent-edit
 * conflicts." This is the one test that chains multiple REAL
 * `executeMutationPlan` calls (never buildRequest/parseResponse tested
 * in isolation) against a REAL, temp-dir-backed journal — proving the
 * full plan → apply → verify → record pipeline for the exact resource
 * chain roadmap/18 names.
 */
const BASE_URL = "https://flow-test.atlassian.invalid";
const ENVELOPE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 201, bodyText: JSON.stringify(body) };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-jira-flow-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildCtx(responses: readonly FakeProviderScriptEntry[]): JiraHttpContext {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.100"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  return { connection, httpClient, tokenManager };
}

describe("board → sprint → epic → issue → link → comment(ADF) → worklog → attachment", () => {
  it("every step in the chain applies through the real mutation pipeline and records successfully", async () => {
    const ctx = buildCtx([
      ok({ id: 1, name: "Sprint Board", type: "scrum" }), // board.create
      ok({ id: 10, name: "Sprint 1", state: "future", originBoardId: 1 }), // sprint.create
      ok({ id: "20001", key: "PROJ-1" }), // epic issue.create
      ok({ id: "20002", key: "PROJ-2" }), // story issue.create
      { status: 201, bodyText: "" }, // issue.link (Jira returns 201 empty)
      ok({ id: "50001" }), // comment.create (ADF round trip)
      ok({ id: "30001" }), // worklog.create
      { status: 200, bodyText: JSON.stringify([{ id: "40001" }]) }, // attachment.upload
    ]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const attachmentStaging = new AttachmentStagingRegistry();
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });
    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });
    const lock = new IdempotencyKeyLock();
    const apply = (plan: Parameters<typeof executeMutationPlan>[0]) =>
      executeMutationPlan(
        plan,
        {
          provider: "jira-cloud",
          buildRequest: (p) => applyClient.buildRequest(p),
          parseResponse: (p, r) => applyClient.parseResponse(p, r),
          verify: (p, a) => applyClient.verify?.(p, a) ?? Promise.resolve(true),
        },
        { journal, httpClient: ctx.httpClient, lock },
      );

    // 1. board
    const boardPlan = resourceClient.boards.planCreate(
      { name: "Sprint Board", type: "scrum", projectKeyOrId: "PROJ" },
      ENVELOPE_ID,
    );
    const boardOutcome = await apply(boardPlan);
    expect(boardOutcome.status).toBe("recorded");
    expect(boardOutcome.appliedRevision).toBe("1");

    // 2. sprint
    const sprintPlan = resourceClient.sprints.planCreate(
      { boardId: 1, name: "Sprint 1" },
      ENVELOPE_ID,
    );
    const sprintOutcome = await apply(sprintPlan);
    expect(sprintOutcome.status).toBe("recorded");
    expect(sprintOutcome.appliedRevision).toBe("10");

    // 3. epic (an issue with issueType "Epic")
    const epicPlan = resourceClient.issues.planCreate(
      { projectKeyOrId: "PROJ", issueType: "Epic", summaryAdf: toADF("Epic summary") },
      ENVELOPE_ID,
    );
    const epicOutcome = await apply(epicPlan);
    expect(epicOutcome.status).toBe("recorded");
    expect(epicOutcome.appliedRevision).toBe("PROJ-1");

    // 4. issue (a Story under the epic)
    const issuePlan = resourceClient.issues.planCreate(
      { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: toADF("Story summary") },
      ENVELOPE_ID,
    );
    const issueOutcome = await apply(issuePlan);
    expect(issueOutcome.status).toBe("recorded");
    expect(issueOutcome.appliedRevision).toBe("PROJ-2");

    // 5. link (story -> epic)
    const linkPlan = resourceClient.issues.planLink(
      { linkType: "is child of", outwardIssueKey: "PROJ-2", inwardIssueKey: "PROJ-1" },
      ENVELOPE_ID,
    );
    const linkOutcome = await apply(linkPlan);
    expect(linkOutcome.status).toBe("recorded");

    // 6. comment — ADF/text conversion round trip: markdown -> toADF -> plan -> apply
    const markdown = "Outcome: **linked** the story to its epic.";
    const commentPlan = resourceClient.comments.planCreate(
      "PROJ-2",
      toADF(markdown),
      "flow-marker-1",
      ENVELOPE_ID,
    );
    const commentOutcome = await apply(commentPlan);
    expect(commentOutcome.status).toBe("recorded");
    expect(commentOutcome.appliedRevision).toBe("50001");

    // 7. worklog
    const worklogPlan = resourceClient.worklogs.planCreate(
      "PROJ-2",
      { timeSpentSeconds: 3600 },
      ENVELOPE_ID,
    );
    const worklogOutcome = await apply(worklogPlan);
    expect(worklogOutcome.status).toBe("recorded");
    expect(worklogOutcome.appliedRevision).toBe("30001");

    // 8. attachment
    const stagingId = attachmentStaging.stage({
      filename: "log.txt",
      mimeType: "text/plain",
      content: Buffer.from("attachment bytes"),
    });
    const attachmentPlan = resourceClient.attachments.planUpload(
      "PROJ-2",
      { stagingId, filename: "log.txt", sizeBytes: 17 },
      ENVELOPE_ID,
    );
    const attachmentOutcome = await apply(attachmentPlan);
    expect(attachmentOutcome.status).toBe("recorded");
    expect(attachmentOutcome.appliedRevision).toBe("40001");
  });
});

describe("transitions", () => {
  it("issue.transition applies and its read-back verify confirms the status actually changed", async () => {
    const ctx = buildCtx([
      // planTransition's own server-side done-ness resolution (HIGH H2 fix):
      ok({
        transitions: [
          { id: "31", name: "Close", to: { name: "Done", statusCategory: { key: "done" } } },
        ],
      }),
      { status: 204, bodyText: "" }, // issue.transition apply
      // verify()'s read-back GET:
      ok({
        id: "1",
        key: "PROJ-2",
        fields: {
          summary: "s",
          issuetype: { name: "Story" },
          status: { name: "Done", statusCategory: { key: "done" } },
          updated: "rev-after-transition",
        },
      }),
    ]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });
    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    const plan = await resourceClient.issues.planTransition(
      "PROJ-2",
      "rev-before-transition",
      "31",
      ENVELOPE_ID,
      true, // hasVerificationEvidence — required for a done-targeting transition
    );

    const outcome = await executeMutationPlan(
      plan,
      {
        provider: "jira-cloud",
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: (p, a) => applyClient.verify?.(p, a) ?? Promise.resolve(true),
      },
      { journal, httpClient: ctx.httpClient, lock: new IdempotencyKeyLock() },
    );

    expect(outcome.status).toBe("recorded");
  });
});

describe("concurrent-edit conflicts", () => {
  it("a 412 precondition-failed response on issue.update fails as a typed conflict, never a silent overwrite", async () => {
    const ctx = buildCtx([preconditionFailedResponse()]);
    const payloadRegistry = new JiraPlanPayloadRegistry();
    const resourceClient = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    });
    const applyClient = createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    });

    const plan = resourceClient.issues.planUpdate(
      "PROJ-2",
      "stale-revision",
      { summary: "an edit based on stale data" },
      ENVELOPE_ID,
    );

    const outcome = await executeMutationPlan(
      plan,
      {
        provider: "jira-cloud",
        buildRequest: (p) => applyClient.buildRequest(p),
        parseResponse: (p, r) => applyClient.parseResponse(p, r),
        verify: (p, a) => applyClient.verify?.(p, a) ?? Promise.resolve(true),
      },
      { journal, httpClient: ctx.httpClient, lock: new IdempotencyKeyLock() },
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("conflict");
  });
});

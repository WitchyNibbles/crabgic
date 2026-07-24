import { describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraProviderClient } from "./jira-provider-client.js";
import { createJiraResourceClient } from "./jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import type { JiraHttpContext } from "./http-read-helper.js";

const BASE_URL = "https://provider-client-test.atlassian.invalid";
const ENVELOPE_ID = "55555555-5555-4555-8555-555555555555";

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 200, bodyText: JSON.stringify(body) };
}

function buildClient(responses: readonly FakeProviderScriptEntry[]) {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.40"],
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
  return createJiraProviderClient(resourceClient);
}

describe("createJiraProviderClient — generic dispatch", () => {
  it("search: issue resource dispatches to JQL search", async () => {
    const client = buildClient([ok({ issues: [] })]);
    const result = await client.search?.({ resource: "issue", jql: "project = X" });
    expect(result).toEqual({ issues: [] });
  });

  it("search: project resource dispatches to projects.list", async () => {
    const client = buildClient([ok({ values: [] })]);
    const result = await client.search?.({ resource: "project" });
    expect(result).toEqual([]);
  });

  it("get: board resource dispatches to boards.get", async () => {
    const client = buildClient([ok({ id: 1, name: "B", type: "scrum" })]);
    const result = await client.get?.({ resource: "board", boardId: 1 });
    expect(result).toMatchObject({ id: 1, name: "B" });
  });

  it("planCreate: issue resource builds an issue.create plan", async () => {
    const client = buildClient([]);
    const plan = (await client.planCreate?.({
      resource: "issue",
      projectKeyOrId: "PROJ",
      issueType: "Epic",
      summaryAdf: { type: "doc", version: 1, content: [] },
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("issue.create");
  });

  it("planUpdate: issue resource with op=link builds an issue.link plan", async () => {
    const client = buildClient([]);
    const plan = (await client.planUpdate?.({
      resource: "issue",
      op: "link",
      linkType: "blocks",
      outwardIssueKey: "PROJ-1",
      inwardIssueKey: "PROJ-2",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("issue.link");
  });

  it("planUpdate: sprint resource with op=start builds a sprint.start plan", async () => {
    const client = buildClient([]);
    const plan = (await client.planUpdate?.({
      resource: "sprint",
      op: "start",
      sprintId: 5,
      expectedRevision: "rev-1",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("sprint.start");
  });

  it("planTransition: bulk issueKeys array dispatches to bulk transition", async () => {
    const client = buildClient([]);
    const plan = (await client.planTransition?.({
      issueKeys: ["PROJ-1", "PROJ-2"],
      transitionId: "31",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("issue.bulkTransition");
  });

  it("planTransition: single issueKey dispatches to single transition, resolving done-ness server-side (not from a caller-supplied flag)", async () => {
    const client = buildClient([
      ok({ transitions: [{ id: "31", name: "Start", to: { name: "In Progress" } }] }),
    ]);
    const plan = (await client.planTransition?.({
      issueKey: "PROJ-1",
      expectedRevision: "rev-1",
      transitionId: "31",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("issue.transition");
  });

  it("planComment builds a comment.create plan", async () => {
    const client = buildClient([]);
    const plan = (await client.planComment?.({
      issueKey: "PROJ-1",
      bodyAdf: { type: "doc", version: 1, content: [] },
      marker: "m-1",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("comment.create");
  });

  it("dispatch with a missing resource selector rejects with a validation error", async () => {
    const client = buildClient([]);
    await expect(client.search?.({})).rejects.toMatchObject({ kind: "validation" });
  });

  it("dispatch for an unsupported resource rejects with an unsupported error", async () => {
    const client = buildClient([]);
    await expect(client.get?.({ resource: "comment" })).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("search: sprint/comment/worklog resources all dispatch correctly", async () => {
    const sprintClient = buildClient([ok({ values: [] })]);
    expect(await sprintClient.search?.({ resource: "sprint", boardId: 1 })).toEqual([]);
    const commentClient = buildClient([ok({ comments: [] })]);
    expect(await commentClient.search?.({ resource: "comment", issueKey: "PROJ-1" })).toEqual([]);
    const worklogClient = buildClient([ok({ worklogs: [] })]);
    expect(await worklogClient.search?.({ resource: "worklog", issueKey: "PROJ-1" })).toEqual([]);
  });

  it("search: unsupported resource rejects", async () => {
    const client = buildClient([]);
    await expect(client.search?.({ resource: "attachment" })).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("get: issue, project, and sprint resources all dispatch correctly", async () => {
    const issueClient = buildClient([
      ok({
        id: "1",
        key: "PROJ-1",
        fields: { summary: "s", issuetype: { name: "Task" }, status: { name: "To Do" } },
      }),
    ]);
    expect(
      (await issueClient.get?.({ resource: "issue", issueKey: "PROJ-1" })) as { key: string },
    ).toMatchObject({
      key: "PROJ-1",
    });
    const projectClient = buildClient([ok({ id: "1", key: "PROJ", name: "P" })]);
    expect(
      (await projectClient.get?.({ resource: "project", projectKeyOrId: "PROJ" })) as {
        key: string;
      },
    ).toMatchObject({ key: "PROJ" });
    const sprintClient = buildClient([ok({ id: 5, name: "S", state: "active", originBoardId: 1 })]);
    expect(
      (await sprintClient.get?.({ resource: "sprint", sprintId: 5 })) as { name: string },
    ).toMatchObject({
      name: "S",
    });
  });

  it("planCreate: board, sprint, worklog, and attachment resources all dispatch correctly", async () => {
    const client = buildClient([]);
    const board = (await client.planCreate?.({
      resource: "board",
      name: "B",
      type: "scrum",
      projectKeyOrId: "PROJ",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(board.action).toBe("board.create");

    const sprint = (await client.planCreate?.({
      resource: "sprint",
      boardId: 1,
      name: "S1",
      startDate: "2026-01-01",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(sprint.action).toBe("sprint.create");

    const worklog = (await client.planCreate?.({
      resource: "worklog",
      issueKey: "PROJ-1",
      timeSpentSeconds: 60,
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(worklog.action).toBe("worklog.create");

    const attachment = (await client.planCreate?.({
      resource: "attachment",
      issueKey: "PROJ-1",
      stagingId: "staging-1",
      filename: "a.txt",
      sizeBytes: 1,
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(attachment.action).toBe("attachment.upload");
  });

  it("planCreate: unsupported resource rejects", async () => {
    const client = buildClient([]);
    await expect(
      client.planCreate?.({ resource: "comment", envelopeId: ENVELOPE_ID }),
    ).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("planUpdate: issue op=bulkUpdate and op=rank dispatch correctly", async () => {
    const client = buildClient([]);
    const bulk = (await client.planUpdate?.({
      resource: "issue",
      op: "bulkUpdate",
      issueKeys: ["PROJ-1", "PROJ-2"],
      fields: { summary: "x" },
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(bulk.action).toBe("issue.bulkUpdate");

    const rank = (await client.planUpdate?.({
      resource: "issue",
      op: "rank",
      boardId: 1,
      issueKeys: ["PROJ-1"],
      rankBeforeIssueKey: "PROJ-2",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(rank.action).toBe("issue.rank");
  });

  it("planUpdate: board resource dispatches to board.update", async () => {
    const client = buildClient([]);
    const plan = (await client.planUpdate?.({
      resource: "board",
      boardId: 1,
      patch: { name: "New" },
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("board.update");
  });

  it("planUpdate: sprint op=complete and op=moveIssues dispatch correctly", async () => {
    const client = buildClient([]);
    const complete = (await client.planUpdate?.({
      resource: "sprint",
      op: "complete",
      sprintId: 5,
      expectedRevision: "rev-1",
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(complete.action).toBe("sprint.complete");

    const move = (await client.planUpdate?.({
      resource: "sprint",
      op: "moveIssues",
      sprintId: 5,
      issueKeys: ["PROJ-1"],
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(move.action).toBe("sprint.moveIssues");
  });

  it("planUpdate: sprint resource with an unrecognized op rejects", async () => {
    const client = buildClient([]);
    await expect(
      client.planUpdate?.({
        resource: "sprint",
        op: "bogus",
        sprintId: 5,
        envelopeId: ENVELOPE_ID,
      }),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("planUpdate: comment resource dispatches to comment.update", async () => {
    const client = buildClient([]);
    const plan = (await client.planUpdate?.({
      resource: "comment",
      issueKey: "PROJ-1",
      commentId: "10",
      expectedRevision: "rev-1",
      bodyAdf: { type: "doc", version: 1, content: [] },
      envelopeId: ENVELOPE_ID,
    })) as { action: string };
    expect(plan.action).toBe("comment.update");
  });

  it("planUpdate: unsupported resource rejects", async () => {
    const client = buildClient([]);
    await expect(
      client.planUpdate?.({ resource: "project", envelopeId: ENVELOPE_ID }),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });
});

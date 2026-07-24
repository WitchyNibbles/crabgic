import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { toADF } from "@eo/renderer";
import { buildExternalConnection } from "@eo/testkit";
import { buildFieldMetadataIndex } from "../../capability/field-metadata.js";
import { JiraPlanPayloadRegistry } from "../plan-payload-registry.js";
import { createJiraDatacenterResourceClient } from "./jira-datacenter-resource-client.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";

const BASE_URL = "https://dc-resource-client-test.invalid";
const ENVELOPE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function buildCtx(responses: Parameters<typeof createFakeProviderTransport>[0]["responses"]): {
  ctx: JiraDatacenterHttpContext;
  calls: ReturnType<typeof createFakeProviderTransport>["calls"];
} {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: BASE_URL,
  });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.220"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return {
    ctx: {
      connection,
      httpClient,
      authHeaderProvider: async () => ({ authorization: "Bearer x" }),
    },
    calls: fake.calls,
  };
}

describe("createJiraDatacenterResourceClient — resource-by-resource conformance", () => {
  it("supports project/board/sprint/issue/comment/link/worklog/attachment via the SAME JiraResourceClient contract 18 established", async () => {
    const { ctx } = buildCtx([]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      dcFeatures: {
        edition: "10.3",
        availableActions: [
          "issue.create",
          "issue.update",
          "issue.transition",
          "issue.link",
          "issue.rank",
          "issue.bulkUpdate",
          "issue.bulkTransition",
          "comment.create",
          "comment.update",
          "worklog.create",
          "attachment.upload",
          "board.create",
          "board.update",
          "sprint.create",
          "sprint.start",
          "sprint.complete",
          "sprint.moveIssues",
        ],
        availableFields: "discovered-only",
      },
    });

    // Every plan* method is present and callable (typed IO conformance) —
    // planning is local-only, so these never touch the fake transport.
    const boardPlan = client.boards.planCreate(
      { name: "B", type: "scrum", projectKeyOrId: "PROJ" },
      ENVELOPE_ID,
    );
    expect(boardPlan.action).toBe("board.create");

    const issuePlan = client.issues.planCreate(
      { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: toADF("Summary") },
      ENVELOPE_ID,
    );
    expect(issuePlan.action).toBe("issue.create");

    const commentPlan = client.comments.planCreate(
      "PROJ-1",
      toADF("a comment"),
      "m-1",
      ENVELOPE_ID,
    );
    expect(commentPlan.action).toBe("comment.create");

    const worklogPlan = client.worklogs.planCreate("PROJ-1", { timeSpentSeconds: 60 }, ENVELOPE_ID);
    expect(worklogPlan.action).toBe("worklog.create");

    const linkPlan = client.issues.planLink(
      { linkType: "relates to", outwardIssueKey: "PROJ-1", inwardIssueKey: "PROJ-2" },
      ENVELOPE_ID,
    );
    expect(linkPlan.action).toBe("issue.link");
  });

  it("reads dispatch through the DC (REST v2/Agile) transport, not Cloud's REST v3", async () => {
    const { ctx, calls } = buildCtx([
      { status: 200, bodyText: JSON.stringify([{ id: "1", key: "PROJ", name: "Project" }]) },
    ]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });
    await client.projects.list();
    expect(calls[0]?.url).toContain("/rest/api/2/project");
  });

  it("planTransition resolves the transition's target status via the DC transitions read, refusing an unrecognized transitionId", async () => {
    const { ctx } = buildCtx([{ status: 200, bodyText: JSON.stringify({ transitions: [] }) }]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });
    await expect(
      client.issues.planTransition("PROJ-1", "rev-1", "does-not-exist", ENVELOPE_ID),
    ).rejects.toThrow(ConnectorError);
  });

  it("rejects a mutating action absent from the resolved DC edition's availableActions with typed unsupported, before any plan is built", () => {
    const { ctx } = buildCtx([]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      dcFeatures: { edition: "10.3", availableActions: [], availableFields: "discovered-only" },
    });
    try {
      client.worklogs.planCreate("PROJ-1", { timeSpentSeconds: 60 }, ENVELOPE_ID);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).kind).toBe("unsupported");
    }
  });

  it("rejects every mutating action when dcFeatures is undefined (unrecognized edition, safe default) — proven BEFORE real fixture data lands", () => {
    const { ctx } = buildCtx([]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      // dcFeatures intentionally omitted
    });
    expect(() =>
      client.boards.planCreate({ name: "B", type: "scrum", projectKeyOrId: "PROJ" }, ENVELOPE_ID),
    ).toThrow(ConnectorError);
    expect(() => client.sprints.planCreate({ boardId: 1, name: "S" }, ENVELOPE_ID)).toThrow(
      ConnectorError,
    );
  });

  const FULL_ACTIONS = [
    "issue.create",
    "issue.update",
    "issue.transition",
    "issue.link",
    "issue.rank",
    "issue.bulkUpdate",
    "issue.bulkTransition",
    "comment.create",
    "comment.update",
    "worklog.create",
    "attachment.upload",
    "board.create",
    "board.update",
    "sprint.create",
    "sprint.start",
    "sprint.complete",
    "sprint.moveIssues",
  ] as const;

  it("exercises every remaining plan* method (bulk update/transition, comment update, board update/rank, sprint update/start/complete/moveIssues) and every remaining read (comments/worklogs/sprints/boards/get-by-id)", async () => {
    const { ctx } = buildCtx([
      { status: 200, bodyText: JSON.stringify({ id: 1, name: "Board 1", type: "scrum" }) },
      {
        status: 200,
        bodyText: JSON.stringify({ id: 10, name: "Sprint 1", state: "active", originBoardId: 1 }),
      },
      { status: 200, bodyText: JSON.stringify({ comments: [] }) },
      { status: 200, bodyText: JSON.stringify({ worklogs: [] }) },
      {
        status: 200,
        bodyText: JSON.stringify({
          id: "1",
          key: "PROJ-1",
          fields: { summary: "s", issuetype: { name: "Story" }, status: { name: "To Do" } },
        }),
      },
      { status: 200, bodyText: JSON.stringify({ id: "1", key: "PROJ", name: "P" }) },
    ]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      dcFeatures: {
        edition: "10.3",
        availableActions: FULL_ACTIONS,
        availableFields: "discovered-only",
      },
    });

    expect(
      client.issues.planBulkUpdate(["PROJ-1", "PROJ-2"], { priority: "High" }, ENVELOPE_ID).action,
    ).toBe("issue.bulkUpdate");
    expect(client.issues.planBulkTransition(["PROJ-1"], "31", ENVELOPE_ID).action).toBe(
      "issue.bulkTransition",
    );
    expect(
      client.comments.planUpdate("PROJ-1", "50001", "rev-1", toADF("updated"), ENVELOPE_ID).action,
    ).toBe("comment.update");
    expect(client.boards.planUpdate(1, { name: "New name" }, ENVELOPE_ID).action).toBe(
      "board.update",
    );
    expect(
      client.boards.planRankIssues(1, { issueKeys: ["PROJ-1", "PROJ-2"] }, ENVELOPE_ID).action,
    ).toBe("issue.rank");
    expect(client.sprints.planStart(10, "rev-1", ENVELOPE_ID).action).toBe("sprint.start");
    expect(client.sprints.planComplete(10, "rev-1", ENVELOPE_ID).action).toBe("sprint.complete");
    expect(client.sprints.planMoveIssues(10, ["PROJ-1"], ENVELOPE_ID).action).toBe(
      "sprint.moveIssues",
    );

    await expect(client.boards.get(1)).resolves.toMatchObject({ id: 1, name: "Board 1" });
    await expect(client.sprints.get(10)).resolves.toMatchObject({ id: 10, name: "Sprint 1" });
    await expect(client.comments.list("PROJ-1")).resolves.toEqual([]);
    await expect(client.worklogs.list("PROJ-1")).resolves.toEqual([]);
    await expect(client.issues.get("PROJ-1")).resolves.toMatchObject({ key: "PROJ-1" });
    await expect(client.projects.get("PROJ")).resolves.toEqual({ id: "1", key: "PROJ", name: "P" });
  });

  describe("MINOR-1 (adversarial-review): unsafe-ADF rejections at the PLAN-BUILD boundary are attributed to jira-datacenter", () => {
    const unsafeAdf = {
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

    it("issues.planCreate's summaryAdf rejection is attributed to jira-datacenter, never jira-cloud", () => {
      const { ctx } = buildCtx([]);
      const client = createJiraDatacenterResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry: new JiraPlanPayloadRegistry(),
        dcFeatures: {
          edition: "10.3",
          availableActions: ["issue.create"],
          availableFields: "discovered-only",
        },
      });
      try {
        client.issues.planCreate(
          { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: unsafeAdf },
          ENVELOPE_ID,
        );
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorError);
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
      }
    });

    it("issues.planUpdate's fields.description rejection is attributed to jira-datacenter", () => {
      const { ctx } = buildCtx([]);
      const client = createJiraDatacenterResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry: new JiraPlanPayloadRegistry(),
        dcFeatures: {
          edition: "10.3",
          availableActions: ["issue.update"],
          availableFields: "discovered-only",
        },
      });
      try {
        client.issues.planUpdate("PROJ-1", "rev-1", { description: unsafeAdf }, ENVELOPE_ID);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorError);
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
      }
    });

    it("comments.planCreate's bodyAdf rejection is attributed to jira-datacenter", () => {
      const { ctx } = buildCtx([]);
      const client = createJiraDatacenterResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry: new JiraPlanPayloadRegistry(),
        dcFeatures: {
          edition: "10.3",
          availableActions: ["comment.create"],
          availableFields: "discovered-only",
        },
      });
      try {
        client.comments.planCreate("PROJ-1", unsafeAdf, "m-1", ENVELOPE_ID);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorError);
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
      }
    });

    it("comments.planUpdate's bodyAdf rejection is attributed to jira-datacenter", () => {
      const { ctx } = buildCtx([]);
      const client = createJiraDatacenterResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry: new JiraPlanPayloadRegistry(),
        dcFeatures: {
          edition: "10.3",
          availableActions: ["comment.update"],
          availableFields: "discovered-only",
        },
      });
      try {
        client.comments.planUpdate("PROJ-1", "50001", "rev-1", unsafeAdf, ENVELOPE_ID);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorError);
        expect((err as ConnectorError).provider).toBe("jira-datacenter");
      }
    });
  });
});

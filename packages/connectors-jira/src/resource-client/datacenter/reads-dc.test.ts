import { describe, expect, it } from "vitest";
import { GatewayHttpClient, createFakeProviderTransport } from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import * as readsDc from "./reads-dc.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";

const BASE_URL = "https://dc-reads-test.invalid";

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
    resolveHostAddresses: async () => ["203.0.113.201"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  return {
    ctx: {
      connection,
      httpClient,
      authHeaderProvider: async () => ({ authorization: "Bearer dc-pat" }),
    },
    calls: fake.calls,
  };
}

describe("reads-dc — REST v2 + Agile GET paths", () => {
  it("listProjects hits /rest/api/2/project (not /rest/api/3/)", async () => {
    const { ctx, calls } = buildCtx([
      { status: 200, bodyText: JSON.stringify([{ id: "1", key: "PROJ", name: "Project" }]) },
    ]);
    const projects = await readsDc.listProjects(ctx);
    expect(projects).toEqual([{ id: "1", key: "PROJ", name: "Project" }]);
    expect(calls[0]?.url).toContain("/rest/api/2/project");
    expect(calls[0]?.url).not.toContain("/rest/api/3/");
  });

  it("getProject hits /rest/api/2/project/:id", async () => {
    const { ctx, calls } = buildCtx([
      { status: 200, bodyText: JSON.stringify({ id: "1", key: "PROJ", name: "Project" }) },
    ]);
    const project = await readsDc.getProject(ctx, "PROJ");
    expect(project.key).toBe("PROJ");
    expect(calls[0]?.url).toContain("/rest/api/2/project/PROJ");
  });

  it("listBoards/getBoard/listSprints/getSprint use the shared /rest/agile/1.0/ paths (identical to Cloud)", async () => {
    const { ctx, calls } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          values: [{ id: 1, name: "Board 1", type: "scrum", location: { projectKey: "PROJ" } }],
        }),
      },
      { status: 200, bodyText: JSON.stringify({ id: 1, name: "Board 1", type: "scrum" }) },
      {
        status: 200,
        bodyText: JSON.stringify({
          values: [{ id: 10, name: "Sprint 1", state: "active", originBoardId: 1 }],
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({ id: 10, name: "Sprint 1", state: "active", originBoardId: 1 }),
      },
    ]);
    await readsDc.listBoards(ctx, "PROJ");
    await readsDc.getBoard(ctx, 1);
    await readsDc.listSprints(ctx, 1);
    await readsDc.getSprint(ctx, 10);
    expect(calls[0]?.url).toContain("/rest/agile/1.0/board");
    expect(calls[1]?.url).toContain("/rest/agile/1.0/board/1");
    expect(calls[2]?.url).toContain("/rest/agile/1.0/board/1/sprint");
    expect(calls[3]?.url).toContain("/rest/agile/1.0/sprint/10");
  });

  it("getIssue/listTransitions/listComments/listWorklogs hit /rest/api/2/issue/:key/...", async () => {
    const { ctx, calls } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          id: "1",
          key: "PROJ-1",
          fields: {
            summary: "s",
            issuetype: { name: "Story" },
            status: { name: "To Do", statusCategory: { key: "new" } },
            updated: "rev-1",
          },
        }),
      },
      { status: 200, bodyText: JSON.stringify({ transitions: [] }) },
      { status: 200, bodyText: JSON.stringify({ comments: [] }) },
      { status: 200, bodyText: JSON.stringify({ worklogs: [] }) },
    ]);
    await readsDc.getIssue(ctx, "PROJ-1");
    await readsDc.listTransitions(ctx, "PROJ-1");
    await readsDc.listComments(ctx, "PROJ-1");
    await readsDc.listWorklogs(ctx, "PROJ-1");
    expect(calls[0]?.url).toContain("/rest/api/2/issue/PROJ-1");
    expect(calls[1]?.url).toContain("/rest/api/2/issue/PROJ-1/transitions");
    expect(calls[2]?.url).toContain("/rest/api/2/issue/PROJ-1/comment");
    expect(calls[3]?.url).toContain("/rest/api/2/issue/PROJ-1/worklog");
  });

  it("searchIssues paginates by offset (startAt), computing nextPageToken from total, not a cursor", async () => {
    const { ctx, calls } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          issues: [
            {
              id: "1",
              key: "PROJ-1",
              fields: {
                summary: "s",
                issuetype: { name: "Story" },
                status: { name: "To Do", statusCategory: { key: "new" } },
                updated: "rev-1",
              },
            },
          ],
          startAt: 0,
          maxResults: 1,
          total: 2,
        }),
      },
    ]);
    const result = await readsDc.searchIssues(ctx, "project = PROJ");
    expect(result.issues).toHaveLength(1);
    expect(result.nextPageToken).toBe("1");
    expect(calls[0]?.url).toContain("/rest/api/2/search?jql=");
    expect(calls[0]?.url).toContain("startAt=0");
  });

  it("searchIssues omits nextPageToken once startAt+issues.length reaches total", async () => {
    const { ctx } = buildCtx([
      {
        status: 200,
        bodyText: JSON.stringify({
          issues: [
            {
              id: "1",
              key: "PROJ-1",
              fields: {
                summary: "s",
                issuetype: { name: "Story" },
                status: { name: "To Do" },
              },
            },
          ],
          startAt: 1,
          maxResults: 1,
          total: 2,
        }),
      },
    ]);
    const result = await readsDc.searchIssues(ctx, "project = PROJ", "1");
    expect(result.nextPageToken).toBeUndefined();
  });
});

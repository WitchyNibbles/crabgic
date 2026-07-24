import { describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@eo/gateway";
import { ConnectorError } from "@eo/contracts";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraResourceClient } from "./jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import type { JiraHttpContext } from "./http-read-helper.js";

const BASE_URL = "https://resource-client-test.atlassian.invalid";
const ENVELOPE_ID = "11111111-1111-4111-8111-111111111111";

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 200, bodyText: JSON.stringify(body) };
}

function buildCtx(responses: readonly FakeProviderScriptEntry[]): {
  ctx: JiraHttpContext;
  calls: readonly { readonly method: string; readonly url: string }[];
} {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.11"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  return { ctx: { connection, httpClient, tokenManager }, calls: fake.calls };
}

describe("JiraResourceClient — conformance suite (reads)", () => {
  it("projects: list + get", async () => {
    const { ctx } = buildCtx([
      ok({ values: [{ id: "10000", key: "PROJ", name: "Project" }] }),
      ok({ id: "10000", key: "PROJ", name: "Project" }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const list = await client.projects.list();
    expect(list).toEqual([{ id: "10000", key: "PROJ", name: "Project" }]);
    const got = await client.projects.get("PROJ");
    expect(got.key).toBe("PROJ");
  });

  it("boards: list + get", async () => {
    const { ctx } = buildCtx([
      ok({ values: [{ id: 1, name: "Board 1", type: "scrum", location: { projectKey: "PROJ" } }] }),
      ok({ id: 1, name: "Board 1", type: "scrum" }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const boards = await client.boards.list("PROJ");
    expect(boards).toEqual([{ id: 1, name: "Board 1", type: "scrum", projectKey: "PROJ" }]);
    const board = await client.boards.get(1);
    expect(board.name).toBe("Board 1");
  });

  it("sprints: list + get", async () => {
    const { ctx } = buildCtx([
      ok({ values: [{ id: 5, name: "Sprint 1", state: "active", originBoardId: 1 }] }),
      ok({ id: 5, name: "Sprint 1", state: "active", originBoardId: 1 }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const sprints = await client.sprints.list(1);
    expect(sprints[0]?.name).toBe("Sprint 1");
    const sprint = await client.sprints.get(5);
    expect(sprint.state).toBe("active");
  });

  it("issues: search + get + transitions (epic is just an issue with issueType Epic)", async () => {
    const { ctx } = buildCtx([
      ok({
        issues: [
          {
            id: "20000",
            key: "PROJ-1",
            fields: {
              summary: "Epic summary",
              issuetype: { name: "Epic" },
              status: { name: "To Do", statusCategory: { key: "new" } },
              updated: "2026-01-01T00:00:00.000Z",
            },
          },
        ],
      }),
      ok({
        id: "20000",
        key: "PROJ-1",
        fields: {
          summary: "Epic summary",
          issuetype: { name: "Epic" },
          status: { name: "To Do", statusCategory: { key: "new" } },
          updated: "2026-01-01T00:00:00.000Z",
        },
      }),
      ok({
        transitions: [
          {
            id: "31",
            name: "Start",
            to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
          },
        ],
      }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const search = await client.issues.search("project = PROJ");
    expect(search.issues[0]?.issueType).toBe("Epic");
    const issue = await client.issues.get("PROJ-1");
    expect(issue.status.name).toBe("To Do");
    const transitions = await client.issues.transitions("PROJ-1");
    expect(transitions).toEqual([
      {
        id: "31",
        name: "Start",
        toStatusName: "In Progress",
        toStatusCategoryKey: "indeterminate",
      },
    ]);
  });

  it("comments + worklogs: list", async () => {
    const { ctx } = buildCtx([
      ok({
        comments: [{ id: "1", body: { type: "doc" }, properties: { marker: "m1" }, updated: "r1" }],
      }),
      ok({ worklogs: [{ id: "1", timeSpentSeconds: 3600 }] }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const comments = await client.comments.list("PROJ-1");
    expect(comments[0]?.properties).toEqual({ marker: "m1" });
    const worklogs = await client.worklogs.list("PROJ-1");
    expect(worklogs[0]?.timeSpentSeconds).toBe(3600);
  });

  it("a malformed response fails boundary validation with a validation-kind ConnectorError, never a silent coercion", async () => {
    const { ctx } = buildCtx([
      { status: 200, bodyText: JSON.stringify({ notTheRightShape: true }) },
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    await expect(client.projects.list()).rejects.toMatchObject({ kind: "validation" });
  });

  it("an authentication failure rejects before any resource call succeeds", async () => {
    const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
    const fake = createFakeProviderTransport({ responses: [ok({ values: [] })] });
    const httpClient = new GatewayHttpClient({
      allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
      resolveHostAddresses: async () => ["203.0.113.12"],
      sendRequest: fake.send,
      sleep: async () => undefined,
    });
    const tokenManager = new JiraTokenManager({
      fetchToken: async () => {
        throw new Error("no token for you");
      },
    });
    const client = createJiraResourceClient({
      ctx: { connection, httpClient, tokenManager },
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    await expect(client.projects.list()).rejects.toBeInstanceOf(ConnectorError);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("JiraResourceClient — plan builders (local, no I/O)", () => {
  function client(responses: readonly FakeProviderScriptEntry[] = []) {
    const { ctx, calls } = buildCtx(responses);
    return {
      client: createJiraResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex([]),
        payloadRegistry: new JiraPlanPayloadRegistry(),
      }),
      calls,
    };
  }

  function transitionsResponse(
    transitions: readonly {
      id: string;
      name: string;
      toStatusName: string;
      toStatusCategoryKey?: string;
    }[],
  ): FakeProviderScriptEntry {
    return ok({
      transitions: transitions.map((t) => ({
        id: t.id,
        name: t.name,
        to: {
          name: t.toStatusName,
          ...(t.toStatusCategoryKey !== undefined
            ? { statusCategory: { key: t.toStatusCategoryKey } }
            : {}),
        },
      })),
    });
  }

  it("issues.planCreate builds a valid plan tagged with the issue-creation capability flag, with no network call", () => {
    const { client: c, calls } = client();
    const plan = c.issues.planCreate(
      {
        projectKeyOrId: "PROJ",
        issueType: "Story",
        summaryAdf: { type: "doc", version: 1, content: [] },
      },
      ENVELOPE_ID,
    );
    expect(plan.action).toBe("issue.create");
    expect(plan.requiredCapabilityFlags).toEqual(["issue creation"]);
    expect(calls).toHaveLength(0);
  });

  it("issues.planUpdate tags assignment/reporter-change flags only when those fields are touched", () => {
    const { client: c } = client();
    const untouched = c.issues.planUpdate("PROJ-1", "rev-1", { summary: "x" }, ENVELOPE_ID);
    expect(untouched.requiredCapabilityFlags).toBeUndefined();

    const assigned = c.issues.planUpdate("PROJ-1", "rev-1", { assignee: "user-1" }, ENVELOPE_ID);
    expect(assigned.requiredCapabilityFlags).toEqual(["assignment"]);

    const reporterChanged = c.issues.planUpdate(
      "PROJ-1",
      "rev-1",
      { reporter: "user-2" },
      ENVELOPE_ID,
    );
    expect(reporterChanged.requiredCapabilityFlags).toEqual(["reporter change"]);
  });

  it("issues.planUpdate rejects an undiscovered custom field before building a plan", () => {
    const { client: c } = client();
    expect(() =>
      c.issues.planUpdate("PROJ-1", "rev-1", { customfield_99999: "x" }, ENVELOPE_ID),
    ).toThrow(ConnectorError);
  });

  // HIGH H2 (adversarial-review): `targetStageIsDone` is no longer a
  // caller-supplied parameter at all — `issues.planTransition` resolves
  // the transition's REAL target status category itself, via
  // `issues.transitions(issueKey)` (a legitimate, documented exception to
  // "planning is local-only" — trusting a caller-supplied boolean would
  // let a forged `false` skip the done-evidence gate and the
  // closing-transitions capability flag entirely while still closing the
  // issue on the wire).
  it("issues.planTransition tags closing-transitions only when the SERVER-reported target stage is done", async () => {
    const { client: c } = client([
      transitionsResponse([
        {
          id: "21",
          name: "Start",
          toStatusName: "In Progress",
          toStatusCategoryKey: "indeterminate",
        },
      ]),
      transitionsResponse([
        { id: "31", name: "Close", toStatusName: "Done", toStatusCategoryKey: "done" },
      ]),
    ]);
    const nonClosing = await c.issues.planTransition("PROJ-1", "rev-1", "21", ENVELOPE_ID);
    expect(nonClosing.requiredCapabilityFlags).toBeUndefined();
    const closing = await c.issues.planTransition("PROJ-1", "rev-1", "31", ENVELOPE_ID, true);
    expect(closing.requiredCapabilityFlags).toEqual(["closing transitions"]);
    expect(closing.impactClass).toBe("irreversible");
  });

  it("issues.planTransition refuses a SERVER-reported closing transition with no verification evidence attached, even though the caller supplies none of the done-ness signal anymore", async () => {
    const { client: c } = client([
      transitionsResponse([
        { id: "31", name: "Close", toStatusName: "Done", toStatusCategoryKey: "done" },
      ]),
    ]);
    await expect(c.issues.planTransition("PROJ-1", "rev-1", "31", ENVELOPE_ID)).rejects.toThrow(
      ConnectorError,
    );
  });

  // MAJOR-2 fix (adversarial-validation round): `resolveVerificationPointer`
  // is threaded from `CreateJiraResourceClientDeps` all the way through to
  // `planIssueTransition`'s done-transition guard — real, reachable wiring
  // via the actual client-construction factory, not just the underlying
  // `planIssueTransition` function in isolation.
  it("failing-first: a resolveVerificationPointer dep resolving an exact-match pointer satisfies planTransition's done-guard with NO hand-passed hasVerificationEvidence", async () => {
    const { ctx } = buildCtx([
      transitionsResponse([
        { id: "31", name: "Close", toStatusName: "Done", toStatusCategoryKey: "done" },
      ]),
    ]);
    const c = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      resolveVerificationPointer: (issueKey) => ({
        remoteResourceId: issueKey,
        confirmedRevision: "rev-1",
      }),
    });
    await expect(
      c.issues.planTransition("PROJ-1", "rev-1", "31", ENVELOPE_ID),
    ).resolves.toBeDefined();
  });

  it("a resolveVerificationPointer dep resolving a DIFFERENT revision still refuses (not an exact match)", async () => {
    const { ctx } = buildCtx([
      transitionsResponse([
        { id: "31", name: "Close", toStatusName: "Done", toStatusCategoryKey: "done" },
      ]),
    ]);
    const c = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      resolveVerificationPointer: (issueKey) => ({
        remoteResourceId: issueKey,
        confirmedRevision: "stale-rev",
      }),
    });
    await expect(c.issues.planTransition("PROJ-1", "rev-1", "31", ENVELOPE_ID)).rejects.toThrow(
      ConnectorError,
    );
  });

  it("issues.planTransition refuses (never guesses) a transitionId absent from the server's reported transitions", async () => {
    const { client: c } = client([
      transitionsResponse([{ id: "21", name: "Start", toStatusName: "In Progress" }]),
    ]);
    await expect(c.issues.planTransition("PROJ-1", "rev-1", "999", ENVELOPE_ID)).rejects.toThrow(
      ConnectorError,
    );
  });

  it("issues.planTransition also treats an unrecognized target status name with no done category hint as never-done (never-guess, consistent with mapJiraStatusToWorkflowStage)", async () => {
    const { client: c } = client([
      transitionsResponse([{ id: "77", name: "Weird", toStatusName: "Frobnicating" }]),
    ]);
    const plan = await c.issues.planTransition("PROJ-1", "rev-1", "77", ENVELOPE_ID);
    expect(plan.requiredCapabilityFlags).toBeUndefined();
    expect(plan.impactClass).toBe("reversible");
  });

  it("sprints.planComplete tags sprint-completion", () => {
    const { client: c } = client();
    const plan = c.sprints.planComplete(5, "rev-1", ENVELOPE_ID);
    expect(plan.requiredCapabilityFlags).toEqual(["sprint completion"]);
  });

  it("attachments.planUpload tags attachments and never embeds file bytes/path", () => {
    const { client: c } = client();
    const plan = c.attachments.planUpload(
      "PROJ-1",
      { stagingId: "staging-1", filename: "report.pdf", sizeBytes: 1024 },
      ENVELOPE_ID,
    );
    expect(plan.requiredCapabilityFlags).toEqual(["attachments"]);
    expect(plan.redactedDiff).not.toContain("/");
  });

  it("attachments.planUpload rejects a secret-shaped filename before it can enter redactedDiff (M2 defense-in-depth)", () => {
    const { client: c } = client();
    expect(() =>
      c.attachments.planUpload(
        "PROJ-1",
        { stagingId: "staging-1", filename: "AKIAABCDEFGHIJKLMNOP.txt", sizeBytes: 10 },
        ENVELOPE_ID,
      ),
    ).toThrow(ConnectorError);
  });

  it("issues.planBulkUpdate / planBulkTransition tag bulk-mutations", () => {
    const { client: c } = client();
    const bulkUpdate = c.issues.planBulkUpdate(["PROJ-1", "PROJ-2"], { summary: "x" }, ENVELOPE_ID);
    expect(bulkUpdate.requiredCapabilityFlags).toEqual(["bulk mutations"]);
    const bulkTransition = c.issues.planBulkTransition(["PROJ-1", "PROJ-2"], "31", ENVELOPE_ID);
    expect(bulkTransition.requiredCapabilityFlags).toEqual(["bulk mutations"]);
  });

  it("issues.planLink builds a valid, unflagged plan", () => {
    const { client: c } = client();
    const plan = c.issues.planLink(
      { linkType: "blocks", outwardIssueKey: "PROJ-1", inwardIssueKey: "PROJ-2" },
      ENVELOPE_ID,
    );
    expect(plan.action).toBe("issue.link");
    expect(plan.requiredCapabilityFlags).toBeUndefined();
  });

  it("comments.planCreate / planUpdate build valid plans", () => {
    const { client: c } = client();
    const create = c.comments.planCreate(
      "PROJ-1",
      { type: "doc", version: 1, content: [] },
      "marker-1",
      ENVELOPE_ID,
    );
    expect(create.action).toBe("comment.create");
    const update = c.comments.planUpdate(
      "PROJ-1",
      "c1",
      "rev-1",
      { type: "doc", version: 1, content: [] },
      ENVELOPE_ID,
    );
    expect(update.action).toBe("comment.update");
  });

  // HIGH H1 (adversarial-review): "a javascript:-href ADF and a secret-
  // bearing ADF on comment.create/issue.update are rejected pre-I/O."
  function unsafeHrefAdf() {
    return {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "javascript:alert(document.cookie)" } }],
            },
          ],
        },
      ],
    };
  }

  function secretBearingAdf() {
    return {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "AKIAABCDEFGHIJKLMNOP" }] }],
    };
  }

  it("comments.planCreate rejects a javascript:-href ADF payload before any network I/O", () => {
    const { client: c, calls } = client();
    expect(() => c.comments.planCreate("PROJ-1", unsafeHrefAdf(), "marker-1", ENVELOPE_ID)).toThrow(
      ConnectorError,
    );
    expect(calls).toHaveLength(0);
  });

  it("comments.planCreate rejects a secret-bearing ADF payload before any network I/O", () => {
    const { client: c, calls } = client();
    expect(() =>
      c.comments.planCreate("PROJ-1", secretBearingAdf(), "marker-1", ENVELOPE_ID),
    ).toThrow(ConnectorError);
    expect(calls).toHaveLength(0);
  });

  it("comments.planUpdate rejects a javascript:-href / secret-bearing ADF payload before any network I/O", () => {
    const { client: c, calls } = client();
    expect(() =>
      c.comments.planUpdate("PROJ-1", "c1", "rev-1", unsafeHrefAdf(), ENVELOPE_ID),
    ).toThrow(ConnectorError);
    expect(() =>
      c.comments.planUpdate("PROJ-1", "c1", "rev-1", secretBearingAdf(), ENVELOPE_ID),
    ).toThrow(ConnectorError);
    expect(calls).toHaveLength(0);
  });

  it("issues.planCreate rejects a javascript:-href / secret-bearing summaryAdf before any network I/O", () => {
    const { client: c, calls } = client();
    expect(() =>
      c.issues.planCreate(
        { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: unsafeHrefAdf() },
        ENVELOPE_ID,
      ),
    ).toThrow(ConnectorError);
    expect(() =>
      c.issues.planCreate(
        { projectKeyOrId: "PROJ", issueType: "Story", summaryAdf: secretBearingAdf() },
        ENVELOPE_ID,
      ),
    ).toThrow(ConnectorError);
    expect(calls).toHaveLength(0);
  });

  it("issues.planUpdate rejects a javascript:-href / secret-bearing fields.description before any network I/O", () => {
    const { client: c, calls } = client();
    expect(() =>
      c.issues.planUpdate("PROJ-1", "rev-1", { description: unsafeHrefAdf() }, ENVELOPE_ID),
    ).toThrow(ConnectorError);
    expect(() =>
      c.issues.planUpdate("PROJ-1", "rev-1", { description: secretBearingAdf() }, ENVELOPE_ID),
    ).toThrow(ConnectorError);
    expect(calls).toHaveLength(0);
  });

  it("issues.planUpdate still accepts an update that doesn't touch description at all", () => {
    const { client: c } = client();
    expect(() =>
      c.issues.planUpdate("PROJ-1", "rev-1", { summary: "no description here" }, ENVELOPE_ID),
    ).not.toThrow();
  });

  it("worklogs.planCreate builds a valid plan", () => {
    const { client: c } = client();
    const plan = c.worklogs.planCreate("PROJ-1", { timeSpentSeconds: 1800 }, ENVELOPE_ID);
    expect(plan.action).toBe("worklog.create");
  });

  it("boards.planCreate / planUpdate / planRankIssues build valid plans", () => {
    const { client: c } = client();
    const create = c.boards.planCreate(
      { name: "Board", type: "scrum", projectKeyOrId: "PROJ" },
      ENVELOPE_ID,
    );
    expect(create.action).toBe("board.create");
    const update = c.boards.planUpdate(1, { name: "New name" }, ENVELOPE_ID);
    expect(update.action).toBe("board.update");
    const rank = c.boards.planRankIssues(1, { issueKeys: ["PROJ-1", "PROJ-2"] }, ENVELOPE_ID);
    expect(rank.action).toBe("issue.rank");
  });

  it("sprints.planCreate / planStart / planMoveIssues build valid plans", () => {
    const { client: c } = client();
    const create = c.sprints.planCreate({ boardId: 1, name: "Sprint 2" }, ENVELOPE_ID);
    expect(create.action).toBe("sprint.create");
    const start = c.sprints.planStart(5, "rev-1", ENVELOPE_ID);
    expect(start.action).toBe("sprint.start");
    const move = c.sprints.planMoveIssues(5, ["PROJ-1"], ENVELOPE_ID);
    expect(move.action).toBe("sprint.moveIssues");
  });
});

describe("JiraResourceClient — pagination and optional-field branch coverage", () => {
  it("projects.list pages across multiple pages of exactly 50 items", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      key: `P${i}`,
      name: `Project ${i}`,
    }));
    const { ctx } = buildCtx([ok({ values: fullPage }), ok({ values: [] })]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const projects = await client.projects.list();

    expect(projects).toHaveLength(50);
  });

  it("boards.list omits projectKey when the board carries no location", async () => {
    const { ctx } = buildCtx([ok({ values: [{ id: 1, name: "Board", type: "scrum" }] })]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const boards = await client.boards.list();

    expect(boards[0]).not.toHaveProperty("projectKey");
  });

  it("sprints.get omits startDate/endDate when the sprint carries neither", async () => {
    const { ctx } = buildCtx([ok({ id: 5, name: "Sprint", state: "future", originBoardId: 1 })]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const sprint = await client.sprints.get(5);

    expect(sprint).not.toHaveProperty("startDate");
    expect(sprint).not.toHaveProperty("endDate");
  });

  it("issues.get omits statusCategoryKey and defaults revision to 'unknown' when Jira reports neither", async () => {
    const { ctx } = buildCtx([
      ok({
        id: "1",
        key: "PROJ-1",
        fields: { summary: "s", issuetype: { name: "Task" }, status: { name: "To Do" } },
      }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const issue = await client.issues.get("PROJ-1");

    expect(issue.status).not.toHaveProperty("statusCategoryKey");
    expect(issue.revision).toBe("unknown");
  });

  it("issues.transitions omits toStatusCategoryKey when Jira reports none", async () => {
    const { ctx } = buildCtx([
      ok({ transitions: [{ id: "1", name: "Start", to: { name: "In Progress" } }] }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const transitions = await client.issues.transitions("PROJ-1");

    expect(transitions[0]).not.toHaveProperty("toStatusCategoryKey");
  });

  it("comments.list defaults properties to {} and worklogs.list omits comment when absent", async () => {
    const { ctx } = buildCtx([
      ok({ comments: [{ id: "1", body: {} }] }),
      ok({ worklogs: [{ id: "1", timeSpentSeconds: 60 }] }),
    ]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const comments = await client.comments.list("PROJ-1");
    expect(comments[0]?.properties).toEqual({});
    const worklogs = await client.worklogs.list("PROJ-1");
    expect(worklogs[0]).not.toHaveProperty("comment");
  });

  it("issues.search omits nextPageToken when Jira reports none, and passes a supplied pageToken through", async () => {
    const { ctx, calls } = buildCtx([ok({ issues: [] })]);
    const client = createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
    });

    const result = await client.issues.search("project = PROJ", "cursor-1");

    expect(result).not.toHaveProperty("nextPageToken");
    expect(calls[0]?.url).toContain("cursor-1");
  });
});

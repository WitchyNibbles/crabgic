import { describe, expect, it } from "vitest";
import { ConnectorError, type ExternalConnection } from "@crabgic/contracts";
import { GatewayHttpClient, createFakeProviderTransport } from "@crabgic/gateway";
import { toADF } from "@crabgic/renderer";
import { buildExternalConnection } from "@crabgic/testkit";
import { buildFieldMetadataIndex } from "../../capability/field-metadata.js";
import { JiraPlanPayloadRegistry } from "../plan-payload-registry.js";
import type { JiraFieldMetadata, JiraResourceClient } from "../types.js";
import { createJiraDatacenterResourceClient } from "./jira-datacenter-resource-client.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";

const BASE_URL = "https://dc-resource-client-test.invalid";
const ENVELOPE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * Hoisted to module scope (it was declared mid-`describe`) so the
 * field-refusal suite below can reuse it as its vacuity guard: a client
 * given the FULL action vocabulary cannot be refused by
 * `assertActionSupported`, which throws the SAME kind and provider the
 * field gate does.
 */
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

/** Captures the thrown `ConnectorError` so its typed kind and provider can be asserted — `.toThrow(ConnectorError)` passes for all ten canonical kinds (`docs/verification-playbook.md` §"ASSERT THE TYPED KIND, NOT JUST THE THROW"). */
function catchConnectorError(run: () => void): ConnectorError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ConnectorError);
    return err as ConnectorError;
  }
  throw new Error("expected the Data Center plan-build call to throw, it did not");
}

function buildCtx(
  responses: Parameters<typeof createFakeProviderTransport>[0]["responses"],
  connectionOverrides: Partial<ExternalConnection> = {},
): {
  ctx: JiraDatacenterHttpContext;
  calls: ReturnType<typeof createFakeProviderTransport>["calls"];
} {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: BASE_URL,
    ...connectionOverrides,
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

  /**
   * roadmap/19 criterion 3, the `falls back to typed unsupported for an
   * unrecognized edition` conjunct, and defect
   * `19-unrecognized-edition-fallback-kind-unproven` gap (i). The sibling
   * case above asserts only `.toThrow(ConnectorError)`, which passes for
   * every one of the ten canonical kinds — splitting `assertActionSupported`
   * and downgrading the `dcFeatures === undefined` branch to
   * `ConnectorError.validation` left the whole repository green
   * (`docs/verification-playbook.md` §"ASSERT THE TYPED KIND, NOT JUST THE
   * THROW").
   *
   * The message fragment asserted here is the one that is distinctive to the
   * `dcFeatures === undefined` branch. The OTHER branch (recognized edition,
   * action absent from `availableActions`) says `is unsupported on edition
   * "…"`, so a probe that collapses the two branches cannot satisfy this
   * assertion by accident — playbook §"ASSERT THE RULE'S DISTINCTIVE
   * MESSAGE, NEVER JUST THE OFFENDING FILENAME".
   */
  it("the dcFeatures === undefined fallback is typed unsupported, attributed to jira-datacenter, on its own distinctive branch", () => {
    const { ctx } = buildCtx([]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      // dcFeatures intentionally omitted — the unrecognized-edition fallback
    });
    for (const call of [
      () =>
        client.boards.planCreate({ name: "B", type: "scrum", projectKeyOrId: "PROJ" }, ENVELOPE_ID),
      () => client.sprints.planCreate({ boardId: 1, name: "S" }, ENVELOPE_ID),
      () => client.issues.planUpdate("PROJ-1", "rev-1", { summary: "x" }, ENVELOPE_ID),
    ]) {
      const err = catchConnectorError(call);
      expect(err.kind).toBe("unsupported");
      expect(err.provider).toBe("jira-datacenter");
      expect(err.message).toContain("has not been positively confirmed by discovery");
    }
  });

  /**
   * CONTROL for the case above, so "every branch throws unsupported with
   * that message" cannot satisfy the suite equally well
   * (`docs/verification-playbook.md` §"PIN A 'FAILS' RULING WITH A 'DOES NOT
   * FAIL' CONTROL"): a RECOGNIZED edition whose `availableActions` omits the
   * action is also `unsupported`/`jira-datacenter`, but carries the OTHER
   * message and must NOT carry the fallback one.
   */
  it("CONTROL: a recognized edition's missing action is unsupported too, but on the other branch's message", () => {
    const { ctx } = buildCtx([]);
    const client = createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry: new JiraPlanPayloadRegistry(),
      dcFeatures: { edition: "10.3", availableActions: [], availableFields: "discovered-only" },
    });
    const err = catchConnectorError(() =>
      client.sprints.planCreate({ boardId: 1, name: "S" }, ENVELOPE_ID),
    );
    expect(err.kind).toBe("unsupported");
    expect(err.provider).toBe("jira-datacenter");
    expect(err.message).toContain('is unsupported on edition "10.3"');
    expect(err.message).not.toContain("has not been positively confirmed by discovery");
  });

  /**
   * roadmap/19 criterion 2, the `fields` conjunct, and defect
   * `19-unsupported-fields-and-cassette-conjuncts`. Measured at
   * `3dec9bf`: driving `customfield_99999` through the REAL Data Center
   * client returned `kind="validation" provider="jira-cloud"` on all three
   * write entry points, because the shared field gate hardcoded Cloud's
   * attribution. roadmap/19 §In scope: "Unrecognized fields or actions
   * return typed `unsupported` (P02)".
   *
   * ⚠️ Vacuity guard, deliberate: every client below is given the FULL
   * action vocabulary, so `assertActionSupported` cannot fire. Without
   * that, the action gate — which already throws
   * `unsupported`/`jira-datacenter` — would satisfy the kind and provider
   * assertions with the field gate never reached at all. The message
   * assertion is the second, independent guard on the same trap: only the
   * field gate produces these strings.
   */
  describe("DC-only unsupported FIELDS (roadmap/19 criterion 2, fields conjunct)", () => {
    function dcClientWithNoDiscoveredFields(
      fields: readonly JiraFieldMetadata[] = [],
    ): JiraResourceClient {
      const { ctx } = buildCtx([]);
      return createJiraDatacenterResourceClient({
        ctx,
        fieldMetadataIndex: buildFieldMetadataIndex(fields),
        payloadRegistry: new JiraPlanPayloadRegistry(),
        dcFeatures: {
          edition: "10.3",
          availableActions: FULL_ACTIONS,
          availableFields: "discovered-only",
        },
      });
    }

    const undiscoveredWrites: readonly [string, (client: JiraResourceClient) => unknown][] = [
      [
        "issues.planCreate",
        (client) =>
          client.issues.planCreate(
            {
              projectKeyOrId: "PROJ",
              issueType: "Story",
              summaryAdf: toADF("Summary"),
              fields: { customfield_99999: "x" },
            },
            ENVELOPE_ID,
          ),
      ],
      [
        "issues.planUpdate",
        (client) =>
          client.issues.planUpdate("PROJ-1", "rev-1", { customfield_99999: "x" }, ENVELOPE_ID),
      ],
      [
        "issues.planBulkUpdate",
        (client) =>
          client.issues.planBulkUpdate(
            ["PROJ-1", "PROJ-2"],
            { customfield_99999: "x" },
            ENVELOPE_ID,
          ),
      ],
    ];

    for (const [label, write] of undiscoveredWrites) {
      it(`${label}: an UNDISCOVERED custom field is typed unsupported and attributed to jira-datacenter`, () => {
        const client = dcClientWithNoDiscoveredFields();
        const err = catchConnectorError(() => void write(client));
        expect(err.kind).toBe("unsupported");
        expect(err.provider).toBe("jira-datacenter");
        // Only the FIELD gate produces this string; the action gate says
        // `Jira Data Center action "…" is unsupported…`.
        expect(err.message).toContain(
          'custom field "customfield_99999" is not present in discovered field metadata',
        );
      });
    }

    it("issues.planUpdate: a DISCOVERED custom field with an UNRECOGNIZED schema type is typed unsupported too", () => {
      const client = dcClientWithNoDiscoveredFields([
        {
          id: "customfield_10010",
          name: "Story Points",
          custom: true,
          schemaType: "some-future-jira-type",
        },
      ]);
      const err = catchConnectorError(() =>
        client.issues.planUpdate("PROJ-1", "rev-1", { customfield_10010: "x" }, ENVELOPE_ID),
      );
      expect(err.kind).toBe("unsupported");
      expect(err.provider).toBe("jira-datacenter");
      expect(err.message).toContain(
        'custom field "customfield_10010" has an unrecognized schema type "some-future-jira-type"',
      );
    });

    it("CONTROL: a DISCOVERED custom field with a known schema type still builds a plan (the gate is not a blanket refusal)", () => {
      const client = dcClientWithNoDiscoveredFields([
        { id: "customfield_10010", name: "Story Points", custom: true, schemaType: "number" },
      ]);
      expect(
        client.issues.planUpdate("PROJ-1", "rev-1", { customfield_10010: 5 }, ENVELOPE_ID).action,
      ).toBe("issue.update");
    });
  });

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

/**
 * DEFECT 21 — the Data Center resource client carries its OWN copy of the
 * tenant-derivation line (`jira-datacenter-resource-client.ts`), separate
 * from the Cloud one. A fix applied to only one copy leaves the other
 * producing plans that the gateway's tenant-allowlist admission check would
 * refuse. This is the twin of the Cloud test in
 * `../jira-resource-client.test.ts`.
 *
 * Trap named: a truthy assertion is vacuous here — the fallback chain always
 * yields something. The exact string is the bearer.
 */
describe("createJiraDatacenterResourceClient — plan tenant derivation (defect 21)", () => {
  function planFor(connectionOverrides: Partial<ExternalConnection>) {
    const { ctx } = buildCtx([], connectionOverrides);
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
    return client.issues.planUpdate("PROJ-1", "rev-1", { summary: "x" }, ENVELOPE_ID);
  }

  it("derives the plan tenant from tenantAllowlist[0], not projectAllowlist[0]", () => {
    const plan = planFor({ tenantAllowlist: ["acme"], projectAllowlist: ["PROJ"] });
    expect(plan.tenant).toBe("acme");
  });

  it("CONTROL: without tenantAllowlist the projectAllowlist fallback is unchanged", () => {
    const plan = planFor({ projectAllowlist: ["PROJ"] });
    expect(plan.tenant).toBe("PROJ");
  });
});

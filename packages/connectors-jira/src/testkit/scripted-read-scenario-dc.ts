import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScript,
} from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraDatacenterResourceClient } from "../resource-client/datacenter/jira-datacenter-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import type { ScenarioResults } from "./scripted-read-scenario.js";

/**
 * Data Center equivalent of `./scripted-read-scenario.ts` — roadmap/19-
 * jira-datacenter-adapter.md §Interfaces produced: "DC fixture set —
 * `packages/connectors-jira/fixtures/datacenter/{10.3,11.3}/` (cassettes)
 * ... Consumed by 23 work item 2." The SAME 7-call read scenario Cloud's
 * fixture exercises (project → board → sprint → issue-search → issue.get
 * → comments → worklogs), run through this connector's REAL DC resource
 * client (REST v2 + Agile), against EITHER a hand-authored fake script or
 * a byte-recorded cassette per DC version — `fake-cassette-parity.test.ts`
 * proves both sources drive identical typed results, matching 18's own
 * parity discipline.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

export function buildDatacenterHandAuthoredScenario(): FakeProviderScript {
  return {
    responses: [
      { status: 200, bodyText: JSON.stringify([{ id: "10000", key: "PROJ", name: "Project" }]) },
      {
        status: 200,
        bodyText: JSON.stringify({
          values: [{ id: 1, name: "Board 1", type: "scrum", location: { projectKey: "PROJ" } }],
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          values: [{ id: 10, name: "Sprint 1", state: "active", originBoardId: 1 }],
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          issues: [
            {
              id: "20001",
              key: "PROJ-1",
              fields: {
                summary: "Epic summary",
                issuetype: { name: "Epic" },
                status: { name: "To Do", statusCategory: { key: "new" } },
                updated: "rev-1",
              },
            },
          ],
          startAt: 0,
          maxResults: 50,
          total: 1,
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          id: "20002",
          key: "PROJ-2",
          fields: {
            summary: "Story summary",
            issuetype: { name: "Story" },
            status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
            updated: "rev-2",
          },
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          comments: [
            {
              id: "50001",
              body: "plain wiki-markup body",
              properties: { marker: "m-1" },
              updated: "rev-3",
            },
          ],
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({ worklogs: [{ id: "30001", timeSpentSeconds: 3600 }] }),
      },
    ],
  };
}

/** Loads the byte-recorded cassette fixture for one DC edition (`"10.3"` or `"11.3"`). */
export function loadDatacenterReadScenarioCassette(edition: "10.3" | "11.3"): FakeProviderScript {
  const raw = readFileSync(
    join(HERE, "..", "..", "fixtures", "datacenter", edition, "read-scenario.cassette.json"),
    "utf8",
  );
  return JSON.parse(raw) as FakeProviderScript;
}

const BASE_URL = "https://dc-scripted-scenario.invalid";

/** Runs the fixed 7-call DC read scenario against `script` through a REAL `JiraResourceClient` (Data Center implementation), over this phase's real transport stack. */
export async function runDatacenterScriptedReadScenario(
  script: FakeProviderScript,
): Promise<ScenarioResults> {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: BASE_URL,
  });
  const fake = createFakeProviderTransport(script);
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.91"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const ctx: JiraDatacenterHttpContext = {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer dc-pat" }),
  };
  const client = createJiraDatacenterResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry: new JiraPlanPayloadRegistry(),
    dcFeatures: { edition: "10.3", availableActions: [], availableFields: "discovered-only" },
  });

  const projects = await client.projects.list();
  const boards = await client.boards.list("PROJ");
  const sprints = await client.sprints.list(1);
  await client.issues.search("project = PROJ"); // 4th scripted call (epic search)
  const issue = await client.issues.get("PROJ-2");
  const comments = await client.comments.list("PROJ-2");
  const worklogs = await client.worklogs.list("PROJ-2");

  return { projects, boards, sprints, issue, comments, worklogs };
}

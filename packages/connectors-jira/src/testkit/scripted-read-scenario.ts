import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScript,
} from "@eo/gateway";
import { buildExternalConnection } from "@eo/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";

/**
 * roadmap/18 §Interfaces produced: "Fake-Jira: scriptable REST v3 + Agile
 * API double, fault-injectable, extending 16's fake-provider harness."
 * + "Recorded Cloud v3/Agile cassettes." + "Fake/cassette parity suite:
 * proves the fake and a cassette replay of the same scripted scenario
 * yield identical typed results." Work item 6.
 *
 * `HAND_AUTHORED_READ_SCENARIO` ("the fake") and
 * `./fixtures/read-scenario.cassette.json` ("the recorded cassette") are
 * deliberately kept as two INDEPENDENT sources for the SAME 7-call
 * scripted scenario (projects → boards → sprints → issues.search →
 * issues.get → comments → worklogs) — `fake-cassette-parity.test.ts`
 * proves they drive this connector's `JiraResourceClient` to byte-
 * identical typed results, which is only meaningful if the two sources
 * are maintained independently rather than one being derived from the
 * other at runtime.
 */
export const HAND_AUTHORED_READ_SCENARIO: FakeProviderScript = {
  responses: [
    {
      status: 200,
      bodyText: JSON.stringify({ values: [{ id: "10000", key: "PROJ", name: "Project" }] }),
    },
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
          { id: "50001", body: { type: "doc" }, properties: { marker: "m-1" }, updated: "rev-3" },
        ],
      }),
    },
    {
      status: 200,
      bodyText: JSON.stringify({ worklogs: [{ id: "30001", timeSpentSeconds: 3600 }] }),
    },
  ],
};

const HERE = dirname(fileURLToPath(import.meta.url));

/** Loads the byte-recorded cassette fixture (independent of `HAND_AUTHORED_READ_SCENARIO` above) as a `FakeProviderScript`. */
export function loadReadScenarioCassette(): FakeProviderScript {
  const raw = readFileSync(join(HERE, "fixtures", "read-scenario.cassette.json"), "utf8");
  return JSON.parse(raw) as FakeProviderScript;
}

export interface ScenarioResults {
  readonly projects: unknown;
  readonly boards: unknown;
  readonly sprints: unknown;
  readonly issue: unknown;
  readonly comments: unknown;
  readonly worklogs: unknown;
}

const BASE_URL = "https://scripted-scenario.atlassian.invalid";

/** Runs the fixed 7-call read scenario against `script` (either source) through a REAL `JiraResourceClient`, over this phase's real transport stack (never a bespoke shortcut). */
export async function runScriptedReadScenario(
  script: FakeProviderScript,
): Promise<ScenarioResults> {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport(script);
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.90"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  const client = createJiraResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry: new JiraPlanPayloadRegistry(),
  });

  const projects = await client.projects.list();
  const boards = await client.boards.list("PROJ");
  const sprints = await client.sprints.list(1);
  await client.issues.search("project = PROJ"); // the 4th scripted call (epic search) — consumed here so the 5th entry (issues.get) lines up
  const issue = await client.issues.get("PROJ-2");
  const comments = await client.comments.list("PROJ-2");
  const worklogs = await client.worklogs.list("PROJ-2");

  return { projects, boards, sprints, issue, comments, worklogs };
}

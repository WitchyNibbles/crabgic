/**
 * roadmap/23-release-hardening.md work item 6: "forged delete/admin ...
 * (fail pre-network); raw-tool denial." Three REAL, already-built
 * enforcement surfaces (never reimplemented):
 *
 *  1. `@eo/connectors-jira`'s `assertAllowedJiraOperation`/`isJiraAction` —
 *     a closed allowlist (17 members, no delete/admin/impersonation/raw
 *     endpoint) enforced BEFORE any plan/request construction.
 *  2. `@eo/connectors-grafana`'s `createGrafanaProviderAdapter` — an
 *     object whose own `Object.keys()` is exactly
 *     `{list, get, planCreate, planUpdate}`, with no forged delete/admin
 *     method ever constructible.
 *  3. `@eo/gateway`'s REAL native MCP tool registry, booted over stdio via
 *     the EXACT SAME fixture `packages/gateway/src/mcp/server.test.ts`
 *     itself spawns (`packages/gateway/src/mcp/test-support/
 *     stdio-boot-fixture.mjs`, referenced here read-only, never copied or
 *     modified) — proving the full, real 18-tool surface contains no raw
 *     HTTP-passthrough / generic-execute tool a caller could use to bypass
 *     the mutation pipeline's SSRF guard and exactly-once semantics.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CapabilitySnapshotSchema, ConnectorError, CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import { assertAllowedJiraOperation, isJiraAction } from "@eo/connectors-jira";
import {
  createGrafanaProviderAdapter,
  GRAFANA_RESOURCE_KINDS,
  GrafanaPlanPayloadStore,
  GrafanaRollbackSnapshotStore,
} from "@eo/connectors-grafana";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
  recordEmittedEvidenceIds,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

let tj: ScenarioJournal;

/**
 * The ids of every `EvidenceRecord` THIS FILE appended, accumulated across
 * the whole file (module scope, so it survives the per-test `beforeEach`
 * journal). The tagging test below reads only these back — under a shared
 * journal (`EO_RELEASE_GATE_JOURNAL_DIR`) the journal also holds every
 * sibling harness's entries, tagged for other release-gate items.
 */
const emittedIds = new Set<string>();
let recording: ReturnType<typeof recordEmittedEvidenceIds>;

beforeEach(async () => {
  tj = await createScenarioJournal();
  recording = recordEmittedEvidenceIds(tj.store, emittedIds);
});

afterEach(async () => {
  await tj.cleanup();
});

describe("Jira — forged delete/admin/impersonation/raw-endpoint actions fail pre-network (closed allowlist)", () => {
  const FORGED_ACTIONS = [
    "issue.delete",
    "project.delete",
    "user.impersonate",
    "permission.grant",
    "workflow.scheme.edit",
    "security.scheme.edit",
    "automation.rule.create",
    "raw.request",
  ];

  it.each(FORGED_ACTIONS)(
    "%s is outside JIRA_ACTIONS and throws policy_blocked before any plan/request is built",
    (action) => {
      expect(isJiraAction(action)).toBe(false);
      let thrown: unknown;
      try {
        assertAllowedJiraOperation(action);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).kind).toBe("policy_blocked");
    },
  );

  it("a real allowlisted action never throws (proves this isn't a blanket ban)", () => {
    expect(isJiraAction("issue.create")).toBe(true);
    expect(() => assertAllowedJiraOperation("issue.create")).not.toThrow();
  });
});

describe("Grafana — no forged delete/admin operation is ever constructible on the real adapter surface", () => {
  const FORGED_OPERATION_NAMES = [
    "delete",
    "remove",
    "deleteFolder",
    "deleteDashboard",
    "deleteUser",
    "createUser",
    "createOrg",
    "updateDataSourceSecret",
    "replaceNotificationPolicyTree",
    "adminMutate",
  ] as const;

  it("none of the forged operation names exist as callable functions, and Object.keys is exactly the 4-member real surface", async () => {
    const send = async () => ({ status: 200, headers: {}, bodyText: "{}" });
    const adapter = createGrafanaProviderAdapter({
      baseUrl: "https://forged-fixture.invalid",
      externalConnectionId: "00000000-0000-4000-8000-000000000701",
      tenant: "tenant-1",
      envelopeId: "00000000-0000-4000-8000-000000000702",
      getSnapshot: async () =>
        CapabilitySnapshotSchema.parse({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          id: "00000000-0000-4000-8000-000000000703",
          externalConnectionId: "00000000-0000-4000-8000-000000000701",
          product: "grafana",
          edition: "oss",
          version: "13.1.0",
          apiFamilies: [],
          resources: [...GRAFANA_RESOURCE_KINDS],
          actions: ["list", "get", "create", "update"],
          permissions: ["read", "write"],
          isReadOnly: false,
          discoveredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      send,
      payloadStore: new GrafanaPlanPayloadStore(),
      snapshotStore: new GrafanaRollbackSnapshotStore(),
    });

    const untyped = adapter as unknown as Record<string, unknown>;
    for (const name of FORGED_OPERATION_NAMES) {
      expect(typeof untyped[name]).not.toBe("function");
    }
    expect(Object.keys(adapter).sort()).toEqual(["get", "list", "planCreate", "planUpdate"].sort());
  });
});

describe("gateway MCP tool surface — no raw HTTP-passthrough / generic-execute tool exists (raw-tool denial)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const GATEWAY_STDIO_FIXTURE = join(
    HERE,
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "gateway",
    "src",
    "mcp",
    "test-support",
    "stdio-boot-fixture.mjs",
  );

  // The exact 18-name native tool set `packages/gateway/src/mcp/
  // server.test.ts` itself asserts against the SAME real fixture — this
  // harness re-derives the assertion independently rather than importing
  // that test file (which is package-internal), against the real, live
  // MCP `listTools()` response, not a hardcoded guess.
  const KNOWN_NATIVE_TOOL_NAMES = [
    "tracker.search",
    "tracker.get",
    "tracker.plan_create",
    "tracker.plan_update",
    "tracker.plan_transition",
    "tracker.plan_comment",
    "tracker.apply",
    "observability.search",
    "observability.get",
    "observability.query",
    "observability.plan_create",
    "observability.plan_update",
    "observability.apply",
    "evidence.attach",
    "evidence.get",
    "result.submit",
    "run.status",
    "run.cancel",
  ];

  const FORGED_RAW_TOOL_NAMES = [
    "http.request",
    "raw.request",
    "raw.execute",
    "gateway.execute",
    "fetch",
    "tracker.delete",
    "tracker.raw",
    "observability.delete",
    "admin.mutate",
  ];

  let journalDir: string;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-gateway-stdio-"));
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  it("the real gateway MCP server's full tool surface is exactly the known 18-tool set, and contains none of the forged raw/passthrough names", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [GATEWAY_STDIO_FIXTURE],
      env: { EO_FIXTURE_JOURNAL_DIR: journalDir },
    });
    const client = new Client({ name: "connector-matrix-raw-tool-denial", version: "0.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      expect(names.sort()).toEqual([...KNOWN_NATIVE_TOOL_NAMES].sort());
      for (const forged of FORGED_RAW_TOOL_NAMES) {
        expect(names).not.toContain(forged);
      }

      await emitScenarioEvidence({
        journal: recording,
        command:
          "connector-matrix: raw-tool denial — real gateway MCP surface contains no raw/passthrough tool",
        exitStatus: 0,
        outcomeContent: JSON.stringify({ names: names.sort() }),
      });
    } finally {
      await client.close();
    }
  });

  it("calling a forged/unregistered tool name against the real server fails ('tool not found'), never silently dispatching", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [GATEWAY_STDIO_FIXTURE],
      env: { EO_FIXTURE_JOURNAL_DIR: journalDir },
    });
    const client = new Client({ name: "connector-matrix-raw-tool-denial-2", version: "0.0.0" });
    try {
      await client.connect(transport);
      // The MCP SDK client surfaces an unknown-tool call as a JSON-RPC
      // error result (`isError: true`) rather than a rejected promise —
      // either way, no dispatch to a real handler ever happens.
      const result = await client.callTool({ name: "http.request", arguments: {} });
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toMatch(/not found/i);
    } finally {
      await client.close();
    }
  });
});

describe("evidence tagging", () => {
  it("every EvidenceRecord emitted in this file is tagged release-gate:connector-matrix", async () => {
    // Scoped to the ids this file itself appended (see `emittedIds`): a
    // bare journal-wide read is only "this file's evidence" while the
    // journal is private, and under `EO_RELEASE_GATE_JOURNAL_DIR` it would
    // instead assert this tag over every OTHER harness's records too.
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && emittedIds.has(entry.payload.id))
        entries.push(entry);
    }
    for (const entry of entries) {
      expect((entry as { payload: { gateTag?: string } }).payload.gateTag).toBe(
        CONNECTOR_MATRIX_GATE_TAG,
      );
    }
  });
});

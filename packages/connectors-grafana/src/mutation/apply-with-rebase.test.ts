import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "@eo/gateway";
import { buildRouteTable, capabilityFlag } from "../discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { hashCanonicalFields } from "../resources/resource-definitions.js";
import { applyGrafanaMutationWithRebase } from "./apply-with-rebase.js";
import {
  createGrafanaMutationApplyClient,
  type GrafanaRawHttpResponse,
} from "./mutation-apply-client.js";
import { buildGrafanaMutationPlan } from "./mutation-plan-builder.js";
import { GrafanaPlanPayloadStore } from "./plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "./snapshot-store.js";
import { getResourceDefinition } from "../resources/definitions/index.js";

const FAKE_BASE_URL = "https://fake-grafana.invalid";
const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-grafana-apply-with-rebase-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildPipelineDeps(script: readonly FakeProviderScriptEntry[]): {
  deps: MutationPipelineDeps;
  calls: readonly { method: string; url: string }[];
  get: (path: string) => Promise<GrafanaRawHttpResponse>;
} {
  const fakeTransport = createFakeProviderTransport({ responses: script });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [FAKE_BASE_URL] },
    sendRequest: fakeTransport.send,
    resolveHostAddresses: async () => ["203.0.113.12"],
    sleep: async () => undefined,
  });
  const get = async (path: string): Promise<GrafanaRawHttpResponse> => {
    return httpClient.request({
      connectionId: "conn-1",
      tenant: "tenant-1",
      resource: path,
      url: new URL(path, FAKE_BASE_URL),
      method: "GET",
    });
  };
  return {
    deps: { journal, httpClient, lock: new IdempotencyKeyLock() },
    calls: fakeTransport.calls,
    get,
  };
}

function buildHandlers(
  applyClient: ReturnType<typeof createGrafanaMutationApplyClient>,
): MutationPipelineHandlers {
  return {
    provider: "grafana",
    buildRequest: (plan) => applyClient.buildRequest(plan),
    parseResponse: (plan, response) => applyClient.parseResponse(plan, response),
    verify: (plan, applied) => applyClient.verify!(plan, applied),
    reconcileAmbiguous: (plan, cause) => applyClient.reconcileAmbiguous!(plan, cause),
  };
}

const BASELINE_FIELDS = { title: "Team Dashboards", parentUid: null };
const BASELINE_HASH = hashCanonicalFields(BASELINE_FIELDS);

describe("applyGrafanaMutationWithRebase — exit criterion: every 409/412 resolves to fetch-compare-rebase or an explicit typed block", () => {
  it("412 + remote content UNCHANGED since baseline -> safely rebases and completes as recorded", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, calls, get } = buildPipelineDeps([
      { status: 412, bodyText: "" }, // the original PUT: precondition failed
      { status: 200, bodyText: JSON.stringify(BASELINE_FIELDS), headers: { etag: '"etag-fresh"' } }, // fetch-compare GET: content unchanged
      { status: 200, bodyText: JSON.stringify({}) }, // the rebased PUT succeeds
      { status: 200, bodyText: JSON.stringify(BASELINE_FIELDS), headers: { etag: '"etag-fresh"' } }, // rebased plan's own verify GET
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const planId = "00000000-0000-4000-8000-000000000010";
    payloadStore.set(planId, { kind: "folder", action: "update", input: BASELINE_FIELDS });
    const plan = buildGrafanaMutationPlan({
      id: planId,
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: BASELINE_FIELDS,
      idempotencyKey: "op-rebase-safe",
      expectedRemoteRevision: "etag-stale",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder.title: unchanged (stale precondition only)",
    });

    const outcome = await applyGrafanaMutationWithRebase(plan, buildHandlers(applyClient), deps, {
      definition: getResourceDefinition("folder"),
      basePath: FULL_ROUTE_TABLE.folder!.basePath,
      externalId: "fold-1",
      baselineContentHash: BASELINE_HASH,
      get,
      payloadStore,
    });

    expect(outcome.status).toBe("recorded");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2); // original (412) + rebased (success)
  });

  it("409 + remote content DIVERGED since baseline -> blocks explicitly, never retries the write", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, calls, get } = buildPipelineDeps([
      { status: 409, bodyText: "" }, // the original PUT: conflict
      {
        status: 200,
        bodyText: JSON.stringify({ title: "Someone Else's Edit", parentUid: null }),
        headers: { etag: '"etag-other"' },
      }, // fetch-compare GET: genuinely different content
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const planId = "00000000-0000-4000-8000-000000000011";
    payloadStore.set(planId, { kind: "folder", action: "update", input: BASELINE_FIELDS });
    const plan = buildGrafanaMutationPlan({
      id: planId,
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: BASELINE_FIELDS,
      idempotencyKey: "op-rebase-conflict",
      expectedRemoteRevision: "etag-stale",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder.title: Team Dashboards -> Team Dashboards (concurrent edit present)",
    });

    const outcome = await applyGrafanaMutationWithRebase(plan, buildHandlers(applyClient), deps, {
      definition: getResourceDefinition("folder"),
      basePath: FULL_ROUTE_TABLE.folder!.basePath,
      externalId: "fold-1",
      baselineContentHash: BASELINE_HASH,
      get,
      payloadStore,
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("conflict");
    // Only the ORIGINAL PUT attempt was ever made — no blind retry over
    // someone else's divergent change.
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("409 + the fetch-compare GET itself fails -> blocks (never assumes safety when it can't even check)", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, get } = buildPipelineDeps([
      { status: 409, bodyText: "" },
      { status: 503, bodyText: "" }, // fetch-compare GET fails
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const planId = "00000000-0000-4000-8000-000000000013";
    payloadStore.set(planId, { kind: "folder", action: "update", input: BASELINE_FIELDS });
    const plan = buildGrafanaMutationPlan({
      id: planId,
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: BASELINE_FIELDS,
      idempotencyKey: "op-rebase-fetch-fails",
      expectedRemoteRevision: "etag-stale",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder: fetch-compare GET fails",
    });

    const outcome = await applyGrafanaMutationWithRebase(plan, buildHandlers(applyClient), deps, {
      definition: getResourceDefinition("folder"),
      basePath: FULL_ROUTE_TABLE.folder!.basePath,
      externalId: "fold-1",
      baselineContentHash: BASELINE_HASH,
      get,
      payloadStore,
    });

    expect(outcome.status).toBe("blocked");
    expect(outcome.detail).toMatch(/could not read current remote state/);
  });

  it("a non-conflict outcome (plain success) passes through untouched — no extra fetch-compare call at all", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, calls, get } = buildPipelineDeps([
      { status: 200, bodyText: JSON.stringify({}) },
      { status: 200, bodyText: JSON.stringify(BASELINE_FIELDS), headers: { etag: '"etag-2"' } },
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const planId = "00000000-0000-4000-8000-000000000012";
    payloadStore.set(planId, { kind: "folder", action: "update", input: BASELINE_FIELDS });
    const plan = buildGrafanaMutationPlan({
      id: planId,
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: BASELINE_FIELDS,
      idempotencyKey: "op-rebase-happy",
      expectedRemoteRevision: "etag-1",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder: no-op",
    });

    const outcome = await applyGrafanaMutationWithRebase(plan, buildHandlers(applyClient), deps, {
      definition: getResourceDefinition("folder"),
      basePath: FULL_ROUTE_TABLE.folder!.basePath,
      externalId: "fold-1",
      baselineContentHash: BASELINE_HASH,
      get,
      payloadStore,
    });

    expect(outcome.status).toBe("recorded");
    expect(calls).toHaveLength(2); // PUT + verify GET only — no fetch-compare GET was ever needed
  });
});

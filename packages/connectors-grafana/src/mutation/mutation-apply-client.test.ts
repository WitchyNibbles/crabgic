import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  executeMutationPlan,
  GatewayHttpClient,
  IdempotencyKeyLock,
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "@eo/gateway";
import { createFakeProviderTransport, type FakeProviderScriptEntry } from "@eo/gateway";
import { buildRouteTable, capabilityFlag } from "../discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS } from "../resource-kinds.js";
import { buildGrafanaMutationPlan } from "./mutation-plan-builder.js";
import {
  createGrafanaMutationApplyClient,
  type GrafanaRawHttpResponse,
} from "./mutation-apply-client.js";
import { GrafanaPlanPayloadStore } from "./plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "./snapshot-store.js";
import {
  deriveAnnotationMarkerTag,
  deriveDeterministicUid,
} from "../reconciliation/marker-reconciler.js";

const FAKE_BASE_URL = "https://fake-grafana.invalid";

const FULL_ROUTE_TABLE = buildRouteTable(
  new Set(GRAFANA_RESOURCE_KINDS.map((kind) => capabilityFlag(kind, "legacy"))),
);

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-grafana-mutation-apply-"));
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
    resolveHostAddresses: async () => ["203.0.113.11"],
    sleep: async () => undefined,
  });
  const get = async (path: string): Promise<GrafanaRawHttpResponse> => {
    const response = await httpClient.request({
      connectionId: "conn-1",
      tenant: "tenant-1",
      resource: path,
      url: new URL(path, FAKE_BASE_URL),
      method: "GET",
    });
    return response;
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

describe("createGrafanaMutationApplyClient — happy-path create/update through @eo/gateway's real pipeline", () => {
  it("creates a folder: builds the POST, verifies via read-back GET, records applied revision", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, calls, get } = buildPipelineDeps([
      { status: 200, bodyText: JSON.stringify({ uid: "fold-new", version: 1 }) }, // POST create response
      {
        status: 200,
        bodyText: JSON.stringify({ title: "Team Dashboards", parentUid: null }),
        headers: { etag: '"etag-1"' },
      }, // verify GET
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const deterministicUid = deriveDeterministicUid("op-folder-create-1");
    payloadStore.set("00000000-0000-4000-8000-000000000001", {
      kind: "folder",
      action: "create",
      input: { title: "Team Dashboards", parentUid: null },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000001",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "create",
      canonicalId: deterministicUid,
      input: { title: "Team Dashboards", parentUid: null },
      idempotencyKey: "op-folder-create-1",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder: (new) -> Team Dashboards",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("recorded");
    expect(outcome.appliedRevision).toBe("1");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[1]?.method).toBe("GET");
  });

  it("adversarial-review HIGH regression: creates an annotation whose write genuinely landed -> verifies TRUE, records (NOT failed)", async () => {
    // Before the fix, `verify()` compared the read-back canonical fields
    // (which legitimately include the connector's own injected
    // `eo-marker:<uid>` tag) against the RAW, unmarked stored payload —
    // so this exact scenario (a real, successful annotation create)
    // always reported `failed`, never `recorded`.
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const idempotencyKey = "op-annotation-create-happy-path";
    const deterministicUid = deriveDeterministicUid(idempotencyKey);
    const marker = deriveAnnotationMarkerTag(idempotencyKey);

    const { deps, calls, get } = buildPipelineDeps([
      { status: 200, bodyText: JSON.stringify({ id: 7001 }), headers: { etag: '"etag-post-1"' } }, // POST create response
      {
        status: 200,
        // The REAL remote object: caller's own tags PLUS the marker the
        // connector's own buildCreateRequest actually sent.
        bodyText: JSON.stringify({
          text: "deploy v2",
          tags: ["release", marker],
          dashboardUID: "dash-1",
          time: 1700000000000,
        }),
        headers: { etag: '"etag-annotation-7001"' },
      }, // verify GET (found via marker search)
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
      findAnnotationByTag: async (tag) => (tag === marker ? "7001" : undefined),
    });

    const planId = "00000000-0000-4000-8000-000000000090";
    payloadStore.set(planId, {
      kind: "annotation",
      action: "create",
      input: { text: "deploy v2", tags: ["release"], dashboardUID: "dash-1", time: 1700000000000 },
    });
    const plan = buildGrafanaMutationPlan({
      id: planId,
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "annotation",
      action: "create",
      canonicalId: deterministicUid,
      input: { text: "deploy v2", tags: ["release"], dashboardUID: "dash-1", time: 1700000000000 },
      idempotencyKey,
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "annotation: (new) -> deploy v2",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("recorded");
    expect(outcome.appliedRevision).toBe("etag-post-1"); // from the POST response's own ETag (parseResponse), not the later verify GET
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("updates a folder: builds the PUT with the precondition header, verifies", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, get } = buildPipelineDeps([
      { status: 200, bodyText: JSON.stringify({}) }, // PUT update response
      {
        status: 200,
        bodyText: JSON.stringify({ title: "Renamed", parentUid: null }),
        headers: { etag: '"etag-2"' },
      }, // verify GET
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    payloadStore.set("00000000-0000-4000-8000-000000000002", {
      kind: "folder",
      action: "update",
      input: { title: "Renamed", parentUid: null },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000002",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "Renamed", parentUid: null },
      idempotencyKey: "op-folder-update-1",
      expectedRemoteRevision: "etag-1",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder.title: Team Dashboards -> Renamed",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("recorded");
  });

  it("verification fails (mismatched read-back) -> outcome is failed/conflict, never silently recorded", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, get } = buildPipelineDeps([
      { status: 200, bodyText: JSON.stringify({}) },
      { status: 200, bodyText: JSON.stringify({ title: "Something Else", parentUid: null }) }, // wrong content
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });
    payloadStore.set("00000000-0000-4000-8000-000000000003", {
      kind: "folder",
      action: "update",
      input: { title: "Renamed", parentUid: null },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000003",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "update",
      canonicalId: "fold-1",
      input: { title: "Renamed", parentUid: null },
      idempotencyKey: "op-folder-update-2",
      expectedRemoteRevision: "etag-1",
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder.title: Team Dashboards -> Renamed",
    });
    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("failed");
  });
});

describe("reconciliation — exit criterion: ambiguous-POST-timeout resolves via marker search, never a silent duplicate", () => {
  it("mid-POST timeout on folder create, marker (deterministic uid) IS found remotely -> resolves to recorded, zero duplicate POSTs", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, calls, get } = buildPipelineDeps([
      { status: 0, fault: "mid-post-timeout" }, // the ambiguous POST
      {
        status: 200,
        bodyText: JSON.stringify({ title: "Team Dashboards", parentUid: null }),
        headers: { etag: '"etag-1"' },
      }, // marker GET (found)
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const idempotencyKey = "op-folder-create-ambiguous";
    const deterministicUid = deriveDeterministicUid(idempotencyKey);
    payloadStore.set("00000000-0000-4000-8000-000000000004", {
      kind: "folder",
      action: "create",
      input: { title: "Team Dashboards", parentUid: null },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000004",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "create",
      canonicalId: deterministicUid,
      input: { title: "Team Dashboards", parentUid: null },
      idempotencyKey,
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder: (new) -> Team Dashboards",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("recorded");
    // Exactly one POST attempt was ever made — the ambiguous timeout was
    // resolved via marker search, never a blind retry that could double-create.
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("mid-POST timeout, marker NOT found -> blocks with typed ambiguous_write, never guesses success", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const { deps, calls, get } = buildPipelineDeps([
      { status: 0, fault: "mid-post-timeout" },
      { status: 404, bodyText: "" }, // marker GET: not found
    ]);
    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
    });

    const idempotencyKey = "op-folder-create-ambiguous-2";
    const deterministicUid = deriveDeterministicUid(idempotencyKey);
    payloadStore.set("00000000-0000-4000-8000-000000000005", {
      kind: "folder",
      action: "create",
      input: { title: "Team Dashboards", parentUid: null },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000005",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "folder",
      action: "create",
      canonicalId: deterministicUid,
      input: { title: "Team Dashboards", parentUid: null },
      idempotencyKey,
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "folder: (new) -> Team Dashboards",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("annotation create ambiguity resolves via tag-based marker search, found -> recorded (never a duplicate POST)", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const idempotencyKey = "op-annotation-create-ambiguous";
    const marker = deriveAnnotationMarkerTag(idempotencyKey);
    const { deps, calls, get } = buildPipelineDeps([
      { status: 0, fault: "mid-post-timeout" }, // the ambiguous POST
      {
        status: 200,
        bodyText: JSON.stringify({ text: "deploy", tags: [], dashboardUID: "dash-1", time: 1 }),
        headers: { etag: '"etag-9"' },
      }, // canonical GET for the found annotation
    ]);

    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
      findAnnotationByTag: async (tag) => (tag === marker ? "999" : undefined),
    });

    payloadStore.set("00000000-0000-4000-8000-000000000006", {
      kind: "annotation",
      action: "create",
      input: { text: "deploy", tags: [], dashboardUID: "dash-1", time: 1 },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000006",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "annotation",
      action: "create",
      canonicalId: deriveDeterministicUid(idempotencyKey),
      input: { text: "deploy", tags: [], dashboardUID: "dash-1", time: 1 },
      idempotencyKey,
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "annotation: (new) -> deploy",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("recorded");
    expect(outcome.appliedRevision).toBe("etag-9");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("annotation create ambiguity, tag NOT found -> blocks, never a second POST attempt", async () => {
    const payloadStore = new GrafanaPlanPayloadStore();
    const snapshotStore = new GrafanaRollbackSnapshotStore();
    const idempotencyKey = "op-annotation-create-ambiguous-2";
    const { deps, calls, get } = buildPipelineDeps([{ status: 0, fault: "mid-post-timeout" }]);

    const applyClient = createGrafanaMutationApplyClient({
      baseUrl: FAKE_BASE_URL,
      routeTable: FULL_ROUTE_TABLE,
      payloadStore,
      snapshotStore,
      get,
      findAnnotationByTag: async () => undefined,
    });

    payloadStore.set("00000000-0000-4000-8000-000000000007", {
      kind: "annotation",
      action: "create",
      input: { text: "deploy", tags: [], dashboardUID: "dash-1", time: 1 },
    });
    const plan = buildGrafanaMutationPlan({
      id: "00000000-0000-4000-8000-000000000007",
      externalConnectionId: "11111111-1111-4111-8111-111111111111",
      tenant: "tenant-1",
      kind: "annotation",
      action: "create",
      canonicalId: deriveDeterministicUid(idempotencyKey),
      input: { text: "deploy", tags: [], dashboardUID: "dash-1", time: 1 },
      idempotencyKey,
      envelopeId: "22222222-2222-4222-8222-222222222222",
      redactedDiff: "annotation: (new) -> deploy",
    });

    const outcome = await executeMutationPlan(plan, buildHandlers(applyClient), deps);
    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});

/**
 * roadmap/23-release-hardening.md work item 6: "reuse ... 20's resource
 * clients + their cassettes." Drives the REAL `@crabgic/connectors-grafana`
 * `createGrafanaMutationApplyClient` + `buildGrafanaMutationPlan` against
 * the REAL, already-recorded per-kind cassettes
 * (`@crabgic/connectors-grafana`'s own `fixtures/cassettes.ts` — the same data
 * `integration-cassette-replay.test.ts` uses), through the REAL
 * `executeMutationPlan` exactly-once pipeline — proving replay +
 * changed-payload rejection against a Grafana `annotation` (the
 * `grafana_annotation` `ArtifactKind`), not just a synthetic fixture
 * provider.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  createFakeProviderTransport,
  executeMutationPlan,
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "@crabgic/gateway";
import {
  BUILD_INFO_OSS_13_1,
  buildGrafanaMutationPlan,
  buildKindCreateCassette,
  createGrafanaMutationApplyClient,
  decodeApiFamiliesToRouteTable,
  deriveDeterministicUid,
  discoverGrafanaCapabilities,
  type GrafanaResourceKind,
  GrafanaPlanPayloadStore,
  GrafanaRollbackSnapshotStore,
  type GrafanaRawHttpResponse,
} from "@crabgic/connectors-grafana";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

const FAKE_BASE_URL = "https://connector-matrix-grafana-fixture.invalid";

let journalDir: string;
let journal: JournalStore;
let tj: ScenarioJournal;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-grafana-"));
  journal = createJournalStore({ journalDir });
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
  await tj.cleanup();
});

/** The real, discovered route table for a pinned build-info fixture — mirrors `@crabgic/connectors-grafana`'s own `integration-cassette-replay.test.ts`'s `discoveryDepsFromFixture` recipe exactly (never a hand-rolled route table). */
async function realRouteTableFor(fixture: typeof BUILD_INFO_OSS_13_1) {
  const discovery = await discoverGrafanaCapabilities({
    fetchBuildInfo: async () => fixture.buildInfo,
    probeRoute: async (kind: GrafanaResourceKind, family: "legacy" | "apis") =>
      fixture.routeAvailability[kind].includes(family),
  });
  return decodeApiFamiliesToRouteTable(discovery.apiFamilies);
}

/** Builds the real Grafana annotation apply pipeline over the real recorded (create, verify) cassette pair — mirrors `@crabgic/connectors-grafana`'s own `integration-cassette-replay.test.ts` recipe. */
async function buildAnnotationHarness(idempotencyKey: string) {
  const script = buildKindCreateCassette("annotation", {
    annotationIdempotencyKey: idempotencyKey,
  });
  const fakeTransport = createFakeProviderTransport({ responses: script });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [FAKE_BASE_URL] },
    sendRequest: fakeTransport.send,
    resolveHostAddresses: async () => ["203.0.113.40"],
    sleep: async () => undefined,
  });
  const get = async (path: string): Promise<GrafanaRawHttpResponse> =>
    httpClient.request({
      connectionId: "conn-1",
      tenant: "tenant-1",
      resource: path,
      url: new URL(path, FAKE_BASE_URL),
      method: "GET",
    });
  const payloadStore = new GrafanaPlanPayloadStore();
  const snapshotStore = new GrafanaRollbackSnapshotStore();
  const routeTable = await realRouteTableFor(BUILD_INFO_OSS_13_1);
  const applyClient = createGrafanaMutationApplyClient({
    baseUrl: FAKE_BASE_URL,
    routeTable,
    payloadStore,
    snapshotStore,
    get,
    findAnnotationByTag: async () => "5001",
  });
  const handlers: MutationPipelineHandlers = {
    provider: "grafana",
    buildRequest: (plan) => applyClient.buildRequest(plan),
    parseResponse: (plan, response) => applyClient.parseResponse(plan, response),
    verify: (plan, applied) => applyClient.verify!(plan, applied),
    reconcileAmbiguous: (plan, cause) => applyClient.reconcileAmbiguous!(plan, cause),
  };
  const deps: MutationPipelineDeps = {
    journal,
    httpClient,
    lock: new IdempotencyKeyLock(),
    tenantAllowlist: undefined,
    folderAllowlist: undefined,
  };
  return { payloadStore, handlers, deps, fakeTransport };
}

function buildAnnotationPlan(
  idempotencyKey: string,
  input: Readonly<Record<string, unknown>>,
  payloadStore: GrafanaPlanPayloadStore,
) {
  const planId = randomUUID();
  payloadStore.set(planId, { kind: "annotation", action: "create", input });
  return buildGrafanaMutationPlan({
    id: planId,
    externalConnectionId: "00000000-0000-4000-8000-000000000801",
    tenant: "tenant-1",
    kind: "annotation",
    action: "create",
    canonicalId: deriveDeterministicUid(idempotencyKey),
    input,
    idempotencyKey,
    envelopeId: "00000000-0000-4000-8000-000000000802",
    redactedDiff: "annotation: (new) -> connector-matrix cassette fixture",
  });
}

describe("Grafana annotation — real cassette-replayed create through the real exactly-once pipeline", () => {
  it("a fresh annotation create against the recorded cassette is 'recorded' (green)", async () => {
    const idempotencyKey = "connector-matrix:grafana-annotation:create-1";
    const { payloadStore, handlers, deps, fakeTransport } =
      await buildAnnotationHarness(idempotencyKey);
    const plan = buildAnnotationPlan(
      idempotencyKey,
      { text: "cassette deploy", tags: [], dashboardUID: "cassette-dash-1", time: 1 },
      payloadStore,
    );

    const outcome = await executeMutationPlan(plan, handlers, deps);
    expect(outcome.status).toBe("recorded");
    expect(fakeTransport.calls).toHaveLength(2); // create + read-back verify, per the cassette pair

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: Grafana annotation cassette replay — real executeMutationPlan reports 'recorded'",
      exitStatus: 0,
      outcomeContent: JSON.stringify(outcome),
    });
  });

  it("replaying the SAME plan is byte-identical ('replayed'), with no additional network call", async () => {
    const idempotencyKey = "connector-matrix:grafana-annotation:create-2";
    const { payloadStore, handlers, deps, fakeTransport } =
      await buildAnnotationHarness(idempotencyKey);
    const input = { text: "cassette deploy", tags: [], dashboardUID: "cassette-dash-1", time: 1 };
    const plan = buildAnnotationPlan(idempotencyKey, input, payloadStore);

    const first = await executeMutationPlan(plan, handlers, deps);
    expect(first.status).toBe("recorded");
    const callsAfterFirst = fakeTransport.calls.length;

    // Re-registers the SAME plan's payload (a real replay re-submits the
    // identical desired-state payload under the same idempotencyKey) and
    // re-executes.
    payloadStore.set(plan.id, { kind: "annotation", action: "create", input });
    const second = await executeMutationPlan(plan, handlers, deps);

    expect(second.status).toBe("replayed");
    expect(fakeTransport.calls.length).toBe(callsAfterFirst); // zero additional network calls
  });

  it("a CHANGED payload for the same idempotencyKey is REJECTED as a typed conflict, never silently accepted", async () => {
    const idempotencyKey = "connector-matrix:grafana-annotation:create-3";
    const { payloadStore, handlers, deps, fakeTransport } =
      await buildAnnotationHarness(idempotencyKey);
    const original = buildAnnotationPlan(
      idempotencyKey,
      { text: "cassette deploy", tags: [], dashboardUID: "cassette-dash-1", time: 1 },
      payloadStore,
    );

    const originalOutcome = await executeMutationPlan(original, handlers, deps);
    expect(originalOutcome.status).toBe("recorded");
    const callsAfterOriginal = fakeTransport.calls.length;

    // Same idempotencyKey, same canonicalId — but a materially DIFFERENT
    // desired-state payload (a different annotation text) — this must
    // never be silently applied over the original.
    const changedPlanId = randomUUID();
    const changedInput = {
      text: "CHANGED — this must be rejected",
      tags: [],
      dashboardUID: "cassette-dash-1",
      time: 1,
    };
    payloadStore.set(changedPlanId, { kind: "annotation", action: "create", input: changedInput });
    const changedPlan = buildGrafanaMutationPlan({
      id: changedPlanId,
      externalConnectionId: "00000000-0000-4000-8000-000000000801",
      tenant: "tenant-1",
      kind: "annotation",
      action: "create",
      canonicalId: deriveDeterministicUid(idempotencyKey),
      input: changedInput,
      idempotencyKey,
      envelopeId: "00000000-0000-4000-8000-000000000802",
      redactedDiff: "annotation: (new) -> [CHANGED payload, same idempotencyKey]",
    });

    const changedOutcome = await executeMutationPlan(changedPlan, handlers, deps);

    expect(changedOutcome.status).toBe("conflict");
    expect(changedOutcome.errorKind).toBe("conflict");
    expect(fakeTransport.calls.length).toBe(callsAfterOriginal); // never re-applied over the network

    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: Grafana annotation — changed-payload replay REJECTED as typed conflict (real executeMutationPlan + real cassette)",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ originalOutcome, changedOutcome }),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  createFakeProviderTransport,
  executeMutationPlan,
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "@eo/gateway";
import {
  BUILD_INFO_CLOUD_CURRENT,
  BUILD_INFO_ENTERPRISE_CURRENT,
  BUILD_INFO_OSS_11_6,
  BUILD_INFO_OSS_12_4,
  BUILD_INFO_OSS_13_1,
  type GrafanaBuildInfoFixture,
} from "../discovery/build-info-fixtures.js";
import { discoverGrafanaCapabilities } from "../discovery/capability-discovery.js";
import { decodeApiFamiliesToRouteTable } from "../discovery/route-table.js";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import { deriveDeterministicUid } from "../reconciliation/marker-reconciler.js";
import { buildGrafanaMutationPlan } from "../mutation/mutation-plan-builder.js";
import {
  createGrafanaMutationApplyClient,
  type GrafanaRawHttpResponse,
} from "../mutation/mutation-apply-client.js";
import { GrafanaPlanPayloadStore } from "../mutation/plan-payload-store.js";
import { GrafanaRollbackSnapshotStore } from "../mutation/snapshot-store.js";
import { CREATE_INPUT_BY_KIND, RESOURCE_FLOW_ORDER, buildKindCreateCassette } from "./cassettes.js";
import { ENTERPRISE_DOCKER_RECIPE, OSS_DOCKER_RECIPE } from "./docker-recipes.js";

const FAKE_BASE_URL = "https://fake-grafana.invalid";

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-grafana-cassette-replay-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/** Probes route availability straight from a pinned fixture's own recorded table — the SAME data `route-table.test.ts` already exercises, reused here as this test's `probeRoute` implementation (never a live HTTP probe). */
function discoveryDepsFromFixture(fixture: GrafanaBuildInfoFixture) {
  return {
    fetchBuildInfo: async () => fixture.buildInfo,
    probeRoute: async (kind: GrafanaResourceKind, family: "legacy" | "apis") =>
      fixture.routeAvailability[kind].includes(family),
  };
}

/**
 * Replays the full folder→dashboard→annotation→alert-rule→contact-point→
 * mute-timing→notification-template creation chain against one pinned
 * build-info fixture's discovered route table — roadmap/20 exit criterion.
 */
async function replayFullResourceFlow(fixture: GrafanaBuildInfoFixture): Promise<void> {
  const discovery = await discoverGrafanaCapabilities(discoveryDepsFromFixture(fixture));
  const routeTable = decodeApiFamiliesToRouteTable(discovery.apiFamilies);
  expect(discovery.isReadOnly).toBe(false); // every pinned fixture is a KNOWN, writable build

  // Computed BEFORE building the script (not inside the create loop below)
  // so the cassette's annotation verify response and the plan's own
  // `idempotencyKey` always derive the identical marker tag
  // (adversarial-review HIGH fix — a mismatch here is exactly the bug
  // that made every annotation create report `failed`).
  const idempotencyKeyForKind = (kind: GrafanaResourceKind): string =>
    `${fixture.fixtureLabel}:${kind}:create`;

  const script = RESOURCE_FLOW_ORDER.flatMap((kind) =>
    buildKindCreateCassette(kind, { annotationIdempotencyKey: idempotencyKeyForKind(kind) }),
  );
  const fakeTransport = createFakeProviderTransport({ responses: script });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [FAKE_BASE_URL] },
    sendRequest: fakeTransport.send,
    resolveHostAddresses: async () => ["203.0.113.20"],
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
  const applyClient = createGrafanaMutationApplyClient({
    baseUrl: FAKE_BASE_URL,
    routeTable,
    payloadStore,
    snapshotStore,
    get,
    // Annotations accept no caller-supplied id (`../resources/definitions/
    // annotation.ts`) — this cassette creates exactly one annotation per
    // replay, whose fixture POST response reports id 5001; `verify()`
    // resolves it back via this tag-search fake, never a raw id guess.
    findAnnotationByTag: async () => "5001",
  });
  const handlers: MutationPipelineHandlers = {
    provider: "grafana",
    buildRequest: (plan) => applyClient.buildRequest(plan),
    parseResponse: (plan, response) => applyClient.parseResponse(plan, response),
    verify: (plan, applied) => applyClient.verify!(plan, applied),
    reconcileAmbiguous: (plan, cause) => applyClient.reconcileAmbiguous!(plan, cause),
  };
  const pipelineDeps: MutationPipelineDeps = {
    journal,
    httpClient,
    lock: new IdempotencyKeyLock(),
  };

  for (const kind of RESOURCE_FLOW_ORDER) {
    const input = CREATE_INPUT_BY_KIND[kind];
    const idempotencyKey = idempotencyKeyForKind(kind);
    const deterministicUid = deriveDeterministicUid(idempotencyKey);
    const planId = randomUUID();
    payloadStore.set(planId, { kind, action: "create", input });
    const plan = buildGrafanaMutationPlan({
      id: planId,
      externalConnectionId: "00000000-0000-4000-8000-000000000501",
      tenant: "tenant-1",
      kind,
      action: "create",
      canonicalId: deterministicUid,
      input,
      idempotencyKey,
      envelopeId: "00000000-0000-4000-8000-000000000502",
      redactedDiff: `${kind}: (new) -> cassette fixture`,
    });

    const outcome = await executeMutationPlan(plan, handlers, pipelineDeps);
    expect(outcome.status, `${fixture.fixtureLabel}/${kind} outcome`).toBe("recorded");
  }

  expect(fakeTransport.calls).toHaveLength(RESOURCE_FLOW_ORDER.length * 2);
}

describe("integration: full 7-kind resource chain replays green per pinned version cassette (exit criterion)", () => {
  it("11.6", async () => {
    await replayFullResourceFlow(BUILD_INFO_OSS_11_6);
  });

  it("12.4", async () => {
    await replayFullResourceFlow(BUILD_INFO_OSS_12_4);
  });

  it("13.1", async () => {
    await replayFullResourceFlow(BUILD_INFO_OSS_13_1);
  });

  it("current Cloud", async () => {
    await replayFullResourceFlow(BUILD_INFO_CLOUD_CURRENT);
  });
});

describe("integration: OSS/Enterprise Docker-recipe-backed runs (cassette-replayed — no live container is started, per this repo's no-live-network-calls rule)", () => {
  it("OSS recipe's declared build-info fixture replays the full flow green", async () => {
    expect(OSS_DOCKER_RECIPE.buildInfoFixtureLabel).toBe(BUILD_INFO_OSS_13_1.fixtureLabel);
    await replayFullResourceFlow(BUILD_INFO_OSS_13_1);
  });

  it("Enterprise recipe's declared build-info fixture replays the full flow green", async () => {
    expect(ENTERPRISE_DOCKER_RECIPE.buildInfoFixtureLabel).toBe(
      BUILD_INFO_ENTERPRISE_CURRENT.fixtureLabel,
    );
    await replayFullResourceFlow(BUILD_INFO_ENTERPRISE_CURRENT);
  });
});

describe("drift-CI stub: a replayable cassette set exists for every pinned version (work item 6 starting point)", () => {
  it("every pinned fixture + Enterprise has a non-empty, ordered 7-kind cassette", () => {
    const allFixtures = [
      BUILD_INFO_OSS_11_6,
      BUILD_INFO_OSS_12_4,
      BUILD_INFO_OSS_13_1,
      BUILD_INFO_CLOUD_CURRENT,
      BUILD_INFO_ENTERPRISE_CURRENT,
    ];
    expect(RESOURCE_FLOW_ORDER).toEqual([...GRAFANA_RESOURCE_KINDS]);
    for (const fixture of allFixtures) {
      const script = RESOURCE_FLOW_ORDER.flatMap((kind) =>
        buildKindCreateCassette(kind, {
          annotationIdempotencyKey: `${fixture.fixtureLabel}:${kind}:create`,
        }),
      );
      expect(script.length).toBe(RESOURCE_FLOW_ORDER.length * 2);
      expect(fixture.fixtureLabel.length).toBeGreaterThan(0);
    }
  });
});

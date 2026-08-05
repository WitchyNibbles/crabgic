import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  executeMutationPlan,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type MutationApplyClient,
} from "@crabgic/gateway";
import type { RemoteMutationPlan } from "@crabgic/contracts";
import { buildExternalConnection } from "@crabgic/testkit";
import { JiraTokenManager } from "../auth/token-manager.js";
import { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { buildFieldMetadataIndex } from "../capability/field-metadata.js";
import { resolveDcEditionFeatures } from "../capability/dc-edition-feature-matrix.js";
import { createJiraMutationApplyClient } from "../resource-client/jira-mutation-apply-client.js";
import { createJiraDatacenterMutationApplyClient } from "../resource-client/datacenter/jira-mutation-apply-client-dc.js";
import { createJiraDatacenterResourceClient } from "../resource-client/datacenter/jira-datacenter-resource-client.js";
import { createJiraResourceClient } from "../resource-client/jira-resource-client.js";
import { JiraPlanPayloadRegistry } from "../resource-client/plan-payload-registry.js";
import type { JiraHttpContext } from "../resource-client/http-read-helper.js";
import type { JiraDatacenterHttpContext } from "../resource-client/datacenter/jira-datacenter-http-context.js";
import type { JiraResourceClient } from "../resource-client/types.js";

/**
 * roadmap/18 §Exit criteria 10, second clause: "per-issue write order
 * preserved." This is the CONNECTOR-LEVEL bearer for that clause, and it
 * exists because the previous one was not: the two write-order cases in
 * `./rate-limit-and-write-order.test.ts` call `httpClient.request` with
 * hand-written resource strings, constructing no resource client, no
 * plan and no `executeMutationPlan` call — they evidence 16's transport,
 * not this connector's wiring (see that file's own dated correction).
 *
 * Everything on the path here is real:
 *   - plans built by the REAL `createJiraResourceClient` /
 *     `createJiraDatacenterResourceClient` plan builders, so the
 *     `canonicalTarget` under test is the one production mints — never a
 *     literal written by this file;
 *   - applied through the REAL `executeMutationPlan` with a REAL
 *     temp-dir-backed `JournalStore` and a shared `IdempotencyKeyLock`;
 *   - through a REAL `GatewayHttpClient`, whose injected `sendRequest`
 *     is the only instrumented seam.
 *
 * The `=== 2` different-issue control is load-bearing twice over: it
 * forbids a global-mutex "fix" (which would destroy cross-issue
 * throughput), and it proves the instrumentation can observe overlap at
 * all — without it, a zero-latency `sendRequest` would make every
 * `maxInFlight === 1` assertion pass for free.
 */
const BASE_URL = "https://write-order-test.atlassian.invalid";
const DC_BASE_URL = "https://write-order-test-dc.invalid";
const ENVELOPE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Upper bound on how long one held request waits for a sibling to
 * overlap it, used ONLY as the escape hatch for the serialized case (in
 * which the sibling provably cannot arrive, so no event can release the
 * barrier). Overlap itself is detected by a deferred promise, never by a
 * sleep — so a slow machine lengthens the hold rather than shortening
 * it, which makes the `=== 2` control MORE reliable under load, not
 * less.
 */
const QUIESCENCE_FALLBACK_MS = 300;

/**
 * A positively-confirmed Data Center edition — without one, every
 * mutating `plan*` call on the DC resource client fails closed before a
 * plan is ever built (`jira-datacenter-resource-client.ts:83-94`).
 */
const DC_EDITION = resolveDcEditionFeatures("10.3") ?? {
  edition: "10.3",
  availableActions: [],
  availableFields: "discovered-only" as const,
};

interface OverlapRecorder {
  readonly events: readonly string[];
  readonly maxInFlight: () => number;
  readonly sendRequest: (req: HttpTransportRequest) => Promise<HttpTransportResponse>;
}

/**
 * Instruments the transport seam: each in-flight request is held until
 * EITHER `concurrencyToAwait` requests are simultaneously in flight (a
 * deferred-promise barrier — the fast, deterministic path whenever
 * writes are NOT serialized), OR a sibling has already completed (the
 * fast path for every request after the first once writes ARE
 * serialized), OR `QUIESCENCE_FALLBACK_MS` elapses (the only path
 * available to the FIRST request of a correctly-serialized batch).
 */
function createOverlapRecorder(concurrencyToAwait: number): OverlapRecorder {
  const events: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let completed = 0;
  let releaseBarrier: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });

  return {
    events,
    maxInFlight: () => maxInFlight,
    sendRequest: async (req: HttpTransportRequest): Promise<HttpTransportResponse> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push(`start:${req.method}:${req.url.pathname}`);
      if (inFlight >= concurrencyToAwait) {
        releaseBarrier();
      }
      if (completed === 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          barrier,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, QUIESCENCE_FALLBACK_MS);
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
      }
      inFlight -= 1;
      completed += 1;
      events.push(`end:${req.method}:${req.url.pathname}`);
      return {
        status: 200,
        headers: {},
        bodyText: JSON.stringify({ id: "50001", key: "PROJ-1" }),
      };
    },
  };
}

function buildCloudHttpClient(recorder: OverlapRecorder, address: string): GatewayHttpClient {
  return new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => [address],
    sendRequest: recorder.sendRequest,
    sleep: async () => undefined,
  });
}

interface CloudHarness {
  readonly httpClient: GatewayHttpClient;
  readonly resourceClient: JiraResourceClient;
  readonly applyClient: MutationApplyClient;
  readonly attachmentStaging: AttachmentStagingRegistry;
}

function buildCloudHarness(recorder: OverlapRecorder, address: string): CloudHarness {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const httpClient = buildCloudHttpClient(recorder, address);
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  const payloadRegistry = new JiraPlanPayloadRegistry();
  const attachmentStaging = new AttachmentStagingRegistry();
  return {
    httpClient,
    attachmentStaging,
    resourceClient: createJiraResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
    }),
    applyClient: createJiraMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging,
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    }),
  };
}

interface DatacenterHarness {
  readonly httpClient: GatewayHttpClient;
  readonly resourceClient: JiraResourceClient;
  readonly applyClient: MutationApplyClient;
}

function buildDatacenterHarness(recorder: OverlapRecorder, address: string): DatacenterHarness {
  const connection = buildExternalConnection({
    provider: "jira-datacenter",
    deploymentType: "datacenter",
    baseUrl: DC_BASE_URL,
  });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(DC_BASE_URL).origin] },
    resolveHostAddresses: async () => [address],
    sendRequest: recorder.sendRequest,
    sleep: async () => undefined,
  });
  const ctx: JiraDatacenterHttpContext = {
    connection,
    httpClient,
    authHeaderProvider: async () => ({ authorization: "Bearer tok" }),
  };
  const payloadRegistry = new JiraPlanPayloadRegistry();
  return {
    httpClient,
    resourceClient: createJiraDatacenterResourceClient({
      ctx,
      fieldMetadataIndex: buildFieldMetadataIndex([]),
      payloadRegistry,
      // A positively-confirmed edition — without one every mutating
      // `plan*` call fails closed before a plan is ever built.
      dcFeatures: DC_EDITION,
    }),
    applyClient: createJiraDatacenterMutationApplyClient({
      ctx,
      payloadRegistry,
      attachmentStaging: new AttachmentStagingRegistry(),
      issueMarkerReconciler: { findByMarker: async () => undefined },
      commentMarkerReconciler: () => ({ findByMarker: async () => undefined }),
    }),
  };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connectors-jira-write-order-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

/**
 * The production bridge from `MutationApplyClient` to
 * `MutationPipelineHandlers` lives in `@crabgic/gateway`'s
 * `mutation-apply-tool.ts` and is NOT exercised here (this file calls
 * `executeMutationPlan` directly). Its own forwarding of
 * `serializationTarget` is pinned by
 * `packages/gateway/src/mcp/native-tools/mutation-apply-tool.test.ts` —
 * deleting that line would leave THIS file green.
 */
function applyAll(
  plans: readonly RemoteMutationPlan[],
  applyClient: MutationApplyClient,
  httpClient: GatewayHttpClient,
  provider: string,
): Promise<unknown[]> {
  const lock = new IdempotencyKeyLock();
  const serializationTarget = applyClient.serializationTarget;
  return Promise.all(
    plans.map((plan) =>
      executeMutationPlan(
        plan,
        {
          provider,
          buildRequest: (p) => applyClient.buildRequest(p),
          parseResponse: (p, r) => applyClient.parseResponse(p, r),
          verify: async () => true,
          ...(serializationTarget !== undefined
            ? { serializationTarget: (p: RemoteMutationPlan) => serializationTarget(p) }
            : {}),
        },
        { journal, httpClient, lock, tenantAllowlist: undefined },
      ),
    ),
  );
}

describe("per-issue write order — same issue, different resource kinds (Jira Cloud)", () => {
  it("issue.update and comment.create on PROJ-1 never overlap on the wire", async () => {
    const recorder = createOverlapRecorder(2);
    const h = buildCloudHarness(recorder, "203.0.113.200");
    const updatePlan = h.resourceClient.issues.planUpdate(
      "PROJ-1",
      "rev-1",
      { summary: "s" },
      ENVELOPE_ID,
    );
    const commentPlan = h.resourceClient.comments.planCreate(
      "PROJ-1",
      { type: "doc", version: 1, content: [] },
      "write-order-marker",
      ENVELOPE_ID,
    );

    // Identity is deliberately NOT collapsed — these stay distinct.
    expect(updatePlan.canonicalTarget).toBe("issue:PROJ-1");
    expect(commentPlan.canonicalTarget).toBe("issue:PROJ-1:comment");

    await applyAll([updatePlan, commentPlan], h.applyClient, h.httpClient, "jira-cloud");

    expect(recorder.maxInFlight()).toBe(1);
    // Strictly sequential: the first request's end precedes the second's start.
    const firstEnd = recorder.events.findIndex((e) => e.startsWith("end:"));
    const secondStart = recorder.events.findIndex((e, i) => e.startsWith("start:") && i > 0);
    expect(firstEnd).toBeGreaterThanOrEqual(0);
    expect(secondStart).toBeGreaterThan(firstEnd);
  });

  it("issue.update, worklog.create and attachment.upload on PROJ-1 all take the same mutex", async () => {
    const recorder = createOverlapRecorder(3);
    const h = buildCloudHarness(recorder, "203.0.113.201");
    const stagingId = h.attachmentStaging.stage({
      filename: "notes.txt",
      mimeType: "text/plain",
      content: Buffer.from("hello"),
    });
    const plans = [
      h.resourceClient.issues.planUpdate("PROJ-1", "rev-1", { summary: "s" }, ENVELOPE_ID),
      h.resourceClient.worklogs.planCreate("PROJ-1", { timeSpentSeconds: 60 }, ENVELOPE_ID),
      h.resourceClient.attachments.planUpload(
        "PROJ-1",
        { stagingId, filename: "notes.txt", sizeBytes: 5 },
        ENVELOPE_ID,
      ),
    ];
    expect(plans.map((p) => p.canonicalTarget)).toEqual([
      "issue:PROJ-1",
      "issue:PROJ-1:worklog",
      "issue:PROJ-1:attachment",
    ]);

    await applyAll(plans, h.applyClient, h.httpClient, "jira-cloud");

    expect(recorder.maxInFlight()).toBe(1);
    expect(recorder.events.filter((e) => e.startsWith("start:"))).toHaveLength(3);
  });

  it("CONTROL: writes to DIFFERENT issues still run concurrently", async () => {
    const recorder = createOverlapRecorder(2);
    const h = buildCloudHarness(recorder, "203.0.113.202");
    const plans = [
      h.resourceClient.issues.planUpdate("PROJ-1", "rev-1", { summary: "a" }, ENVELOPE_ID),
      h.resourceClient.comments.planCreate(
        "PROJ-2",
        { type: "doc", version: 1, content: [] },
        "other-issue-marker",
        ENVELOPE_ID,
      ),
    ];

    await applyAll(plans, h.applyClient, h.httpClient, "jira-cloud");

    // Dual purpose: forbids a global write mutex, and proves this
    // instrumentation can observe overlap at all.
    expect(recorder.maxInFlight()).toBe(2);
  });
});

describe("per-issue write order — Jira Data Center shares the fix", () => {
  it("issue.update and comment.create on PROJ-1 never overlap on the wire", async () => {
    const recorder = createOverlapRecorder(2);
    const h = buildDatacenterHarness(recorder, "203.0.113.203");
    const plans = [
      h.resourceClient.issues.planUpdate("PROJ-1", "rev-1", { summary: "s" }, ENVELOPE_ID),
      h.resourceClient.comments.planCreate(
        "PROJ-1",
        { type: "doc", version: 1, content: [] },
        "dc-write-order-marker",
        ENVELOPE_ID,
      ),
    ];
    expect(plans.map((p) => p.canonicalTarget)).toEqual(["issue:PROJ-1", "issue:PROJ-1:comment"]);

    await applyAll(plans, h.applyClient, h.httpClient, "jira-datacenter");

    expect(recorder.maxInFlight()).toBe(1);
  });

  it("CONTROL: writes to DIFFERENT issues still run concurrently", async () => {
    const recorder = createOverlapRecorder(2);
    const h = buildDatacenterHarness(recorder, "203.0.113.204");
    const plans = [
      h.resourceClient.issues.planUpdate("PROJ-1", "rev-1", { summary: "a" }, ENVELOPE_ID),
      h.resourceClient.issues.planUpdate("PROJ-2", "rev-1", { summary: "b" }, ENVELOPE_ID),
    ];

    await applyAll(plans, h.applyClient, h.httpClient, "jira-datacenter");

    expect(recorder.maxInFlight()).toBe(2);
  });
});

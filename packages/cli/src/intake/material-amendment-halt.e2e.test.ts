/**
 * `material-amendment-halt.e2e.spec` — the cross-package seam for
 * roadmap/21-connector-evidence-integration.md:153's second sentence: "a
 * seeded mid-run tracked-field edit halts the run via 11's `material
 * amendment` stop condition before `final_verifying`."
 *
 * WHY THIS FILE IS IN `packages/cli` AND NOT IN `packages/gates`: the
 * criterion's evidence clause names "integration suite in
 * `packages/gates`", and `packages/gates/src/remote-verification-e2e.test.ts`
 * remains that suite — it bears the first sentence entirely plus the
 * classification half of the seeded edit. The HALT half cannot live there:
 * the halt mechanism is phase 11's, inside `@crabgic/supervisor`, and a
 * `gates -> supervisor` package edge would invert the 21 -> 14 -> 13 -> 11
 * phase path. (The package-graph acyclicity checker would in fact accept
 * such an edge today — nothing in gates' transitive closure depends on
 * supervisor — so the binding constraint here is the roadmap phase graph,
 * not `scripts/check-package-graph-acyclic.mjs`.) `packages/cli` is the
 * composition root that already imports supervisor, gates and
 * connectors-jira freely, so it is the only place all three real
 * implementations can meet. This file adds no manifest dependency of any
 * kind; the precedents are `./intake.e2e.test.ts` (supervisor),
 * `../daemon/compose-gate-registry.ts` (gates) and `../bootstrap.ts`
 * (connectors-jira).
 *
 * Nothing here is a stand-in: 18's real `planMilestoneSync` polls a real
 * `JiraResourceClient` over the real gateway fake transport, 21's real
 * `buildJiraFieldDiffs`/`buildMaterialAmendmentSignal` classify the result,
 * and 11's real `haltRunOnMaterialAmendment`/`transitionRun` drive a real
 * `JournalStore` and run-lifecycle state machine. Passing gates' own
 * `MaterialAmendmentSignal` VALUE into supervisor's
 * `haltRunOnMaterialAmendment` is also the compile-time pin on that seam:
 * supervisor declares the signal structurally (it may not import gates),
 * so if either side's shape drifts, this file stops compiling.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  GatewayHttpClient,
  createFakeProviderTransport,
  type FakeProviderScriptEntry,
} from "@crabgic/gateway";
import { buildExternalConnection } from "@crabgic/testkit";
import type { RemoteResource, RunLifecycleState } from "@crabgic/contracts";
import { buildJiraFieldDiffs, buildMaterialAmendmentSignal } from "@crabgic/gates";
import {
  createRunsRegistry,
  haltRunOnMaterialAmendment,
  transitionRun,
  type RunsRegistry,
} from "@crabgic/supervisor";
import {
  JiraPlanPayloadRegistry,
  JiraTokenManager,
  buildFieldMetadataIndex,
  createJiraResourceClient,
  planMilestoneSync,
  type JiraHttpContext,
} from "@crabgic/connectors-jira";

const BASE_URL = "https://material-amendment-halt-e2e.atlassian.invalid";
const ENVELOPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHANGE_SET_ID = "44444444-4444-4444-8444-444444444444";
const CONNECTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUIREMENT_ID = "66666666-6666-4666-8666-666666666666";

let journalDir: string;
let store: JournalStore;
let runs: RunsRegistry;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-cli-material-amendment-halt-e2e-"));
  store = createJournalStore({ journalDir });
  runs = createRunsRegistry();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function ok(body: unknown): FakeProviderScriptEntry {
  return { status: 200, bodyText: JSON.stringify(body) };
}

/**
 * Copied from `packages/connectors-jira/src/intake/milestone-sync.test.ts:22-41`
 * — a REAL `JiraResourceClient` over a real `GatewayHttpClient` and the
 * gateway's own fake provider transport. Copied rather than imported
 * because it is a test-local harness in another package, not exported
 * surface; kept structurally identical so the two fixtures cannot drift
 * into exercising different clients.
 */
function buildResourceClient(responses: readonly FakeProviderScriptEntry[]) {
  const connection = buildExternalConnection({ provider: "jira-cloud", baseUrl: BASE_URL });
  const fake = createFakeProviderTransport({ responses });
  const httpClient = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(BASE_URL).origin] },
    resolveHostAddresses: async () => ["203.0.113.80"],
    sendRequest: fake.send,
    sleep: async () => undefined,
  });
  const tokenManager = new JiraTokenManager({
    fetchToken: async () => ({ accessToken: "tok", expiresInSeconds: 3600, scopes: [] }),
  });
  const ctx: JiraHttpContext = { connection, httpClient, tokenManager };
  return createJiraResourceClient({
    ctx,
    fieldMetadataIndex: buildFieldMetadataIndex([]),
    payloadRegistry: new JiraPlanPayloadRegistry(),
  });
}

function issueBody(updated: string, fields: Readonly<Record<string, string>>): unknown {
  return {
    id: "10001",
    key: "PROJ-1",
    fields: {
      summary: "Ship the login form",
      issuetype: { name: "Task" },
      status: { name: "In Progress" },
      updated,
      ...fields,
    },
  };
}

function milestoneInput(kind: "start" | "material_blocker", previousStamp?: RemoteResource) {
  return {
    issueKey: "PROJ-1",
    kind,
    outcome: "implementation under way",
    evidence: "https://ci.example.invalid/run/1",
    risk: "none",
    next: "finish the form",
    ref: "PROJ-1",
    envelopeId: ENVELOPE_ID,
    revisionPoll: {
      externalConnectionId: CONNECTION_ID,
      ...(previousStamp !== undefined ? { previousStamp } : {}),
    },
  };
}

// Same walk as `./intake.e2e.test.ts:228-230` — to an in-flight state,
// which is where a mid-run remote amendment is discovered.
async function driveToRunning(runId: string): Promise<void> {
  for (const to of ["awaiting_approval", "ready", "running"] satisfies RunLifecycleState[]) {
    await transitionRun({ journal: store, runs, runId, changeSetId: CHANGE_SET_ID, to });
  }
}

async function decisionsFor(runId: string): Promise<readonly { rationale: string }[]> {
  const found: { rationale: string }[] = [];
  for await (const entry of store.queryEntries({ type: "adjudication_decision", runId })) {
    if (entry.type !== "adjudication_decision") continue;
    found.push({ rationale: entry.payload.rationale });
  }
  return found;
}

describe("material-amendment halt — 18's milestone poll chained to 21's classifier and 11's stop condition", () => {
  it("a seeded mid-run tracked-field edit, observed between two milestone polls, halts the run via 11's material_amendment stop condition before final_verifying", async () => {
    const runId = "77777777-0000-4000-8000-000000000001";
    await driveToRunning(runId);

    const resourceClient = buildResourceClient([
      ok(issueBody("rev-1", { description: "v1" })),
      ok(issueBody("rev-2", { description: "v2 - edited remotely mid-run" })),
    ]);
    const deps = {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    };

    // --- 18's producer: two real milestone polls ---
    const first = await planMilestoneSync(milestoneInput("start"), deps);
    expect(first.status).toBe("planned");
    if (first.status !== "planned") throw new Error("unreachable");
    const previousStamp = first.revisionPoll?.currentStamp;
    if (previousStamp === undefined) throw new Error("first poll produced no stamp");

    const second = await planMilestoneSync(milestoneInput("material_blocker", previousStamp), deps);
    expect(second.status).toBe("planned");
    if (second.status !== "planned") throw new Error("unreachable");
    expect(second.revisionPoll?.signal?.material).toBe(true);

    // --- 21's classifier over the two field snapshots ---
    const beforeSnapshot = first.revisionPoll?.fieldSnapshot ?? {};
    const afterSnapshot = second.revisionPoll?.fieldSnapshot ?? {};
    const diffs = buildJiraFieldDiffs(beforeSnapshot, afterSnapshot, []);
    const signal = buildMaterialAmendmentSignal(REQUIREMENT_ID, diffs);
    expect(signal.material).toBe(true);
    expect(signal.materialFields).toEqual(["description"]);

    // --- 11's stop condition, driven by gates' own signal value ---
    const outcome = await haltRunOnMaterialAmendment(signal, {
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
    });
    expect(outcome.halted).toBe(true);
    expect(runs.get(runId)?.runState).toBe("blocked");

    // "before final_verifying", proven against the state machine rather
    // than against a boolean flag: `blocked` is absorbing, so the run can
    // never reach `final_verifying` afterwards.
    await expect(
      transitionRun({
        journal: store,
        runs,
        runId,
        changeSetId: CHANGE_SET_ID,
        to: "verifying",
      }),
    ).rejects.toThrow();
    expect(runs.get(runId)?.runState).toBe("blocked");

    const decisions = await decisionsFor(runId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.rationale).toContain('stop condition "material_amendment"');
  });

  it("control: a revision bump touching only a NON-tracked field fires 18's coarse trigger, is refused by 21's classifier, and does NOT halt the run", async () => {
    // The sharp control. 18's revision signal is deliberately coarse — ANY
    // revision change is material at that level — so a bearer wired as
    // "halt whenever the revision moved" would pass the case above and
    // fail here. The plain unchanged-revision control cannot distinguish
    // the two, because there the coarse trigger does not fire at all.
    const runId = "77777777-0000-4000-8000-000000000002";
    await driveToRunning(runId);

    const resourceClient = buildResourceClient([
      ok(issueBody("rev-1", { description: "v1", customfield_10200: "[alice]" })),
      ok(issueBody("rev-2", { description: "v1", customfield_10200: "[alice,bob]" })),
    ]);
    const deps = {
      resourceClient,
      commentMarkerReconciler: { findByMarker: async () => undefined },
    };

    const first = await planMilestoneSync(milestoneInput("start"), deps);
    expect(first.status).toBe("planned");
    if (first.status !== "planned") throw new Error("unreachable");
    const previousStamp = first.revisionPoll?.currentStamp;
    if (previousStamp === undefined) throw new Error("first poll produced no stamp");

    const second = await planMilestoneSync(milestoneInput("material_blocker", previousStamp), deps);
    expect(second.status).toBe("planned");
    if (second.status !== "planned") throw new Error("unreachable");
    // 18's coarse trigger DID fire — the revision moved.
    expect(second.revisionPoll?.signal?.material).toBe(true);

    // ...and 21's conservative allow-list refuses it: `customfield_10200`
    // has no discovered metadata here (empty metadata array), so
    // `normalizeJiraFieldId` passes the raw id through unchanged and it is
    // not a tracked field.
    const diffs = buildJiraFieldDiffs(
      first.revisionPoll?.fieldSnapshot ?? {},
      second.revisionPoll?.fieldSnapshot ?? {},
      [],
    );
    const signal = buildMaterialAmendmentSignal(REQUIREMENT_ID, diffs);
    expect(signal.material).toBe(false);
    expect(signal.materialFields).toEqual([]);

    const outcome = await haltRunOnMaterialAmendment(signal, {
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
    });
    expect(outcome).toEqual({ halted: false });
    expect(runs.get(runId)?.runState).toBe("running");
    expect(await decisionsFor(runId)).toHaveLength(0);

    // The run walks on cleanly and DOES reach `final_verifying`.
    for (const to of [
      "verifying",
      "integrating",
      "final_verifying",
    ] satisfies RunLifecycleState[]) {
      await transitionRun({ journal: store, runs, runId, changeSetId: CHANGE_SET_ID, to });
    }
    expect(runs.get(runId)?.runState).toBe("final_verifying");
  });
});

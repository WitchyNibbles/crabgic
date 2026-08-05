/**
 * roadmap/23-release-hardening.md work item 6: "ambiguous reconciliation
 * without duplication." Drives the REAL `@crabgic/gateway`
 * `reconcileAmbiguousPost`/`MarkerReconciler` declared interface (16 §In
 * scope, "Ambiguity") plus `executeMutationPlan` — never a reimplementation
 * of the reconcile-or-block decision.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { CURRENT_SCHEMA_VERSION, type RemoteMutationPlan } from "@crabgic/contracts";
import {
  GatewayHttpClient,
  IdempotencyKeyLock,
  executeMutationPlan,
  reconcileAmbiguousPost,
  type MarkerReconciler,
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "@crabgic/gateway";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

function buildCreatePlan(overrides: Partial<RemoteMutationPlan> = {}): RemoteMutationPlan {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    externalConnectionId: randomUUID(),
    tenant: "tenant-connector-matrix",
    canonicalTarget: "issue:CM-2:comment",
    action: "comment.create",
    redactedDiff: "comment: (new) -> [ambiguous-reconciliation fixture]",
    desiredStateHash: "sha256:connector-matrix-ambiguous-fixture-1",
    idempotencyKey: "connector-matrix:ambiguous-reconciliation:op-1",
    impactClass: "reversible",
    rollbackClass: "none",
    envelopeId: randomUUID(),
    ...overrides,
  };
}

let journalDir: string;
let journal: JournalStore;
let tj: ScenarioJournal;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-ambiguous-"));
  journal = createJournalStore({ journalDir });
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
  await tj.cleanup();
});

/** Models the remote's own durable "created objects, keyed by marker" index — exactly what a real Jira entity-property / Grafana annotation-tag marker mechanism backs. */
function buildFakeRemoteMarkerIndex(): {
  reconciler: MarkerReconciler;
  markObjectCreated: (marker: string, id: string) => void;
} {
  const index = new Map<string, string>();
  return {
    reconciler: {
      findByMarker: async (marker) => index.get(marker),
    },
    markObjectCreated: (marker, id) => {
      index.set(marker, id);
    },
  };
}

describe("ambiguous reconciliation — a mid-POST timeout that DID land is reconciled via marker search, never re-applied", () => {
  it("uses the REAL reconcileAmbiguousPost(reconciler, marker): the create already landed remotely (marker found) -> pipeline converges to 'recorded' with zero additional network calls", async () => {
    const { reconciler, markObjectCreated } = buildFakeRemoteMarkerIndex();
    const plan = buildCreatePlan();

    // The remote object already exists under this plan's own idempotencyKey
    // marker — as if the create's HTTP response was lost to a timeout AFTER
    // the remote had already durably applied it.
    markObjectCreated(plan.idempotencyKey, "remote-object-77");

    let networkCalls = 0;
    const httpClient = new GatewayHttpClient({
      allowlist: {
        allowedSchemes: ["https:"],
        allowedOrigins: ["https://connector-matrix-fixture.invalid"],
      },
      resolveHostAddresses: async () => ["203.0.113.95"],
      sendRequest: async () => {
        networkCalls += 1;
        throw new Error("ETIMEDOUT: simulated mid-POST ambiguous timeout");
      },
      sleep: async () => undefined,
    });
    const deps: MutationPipelineDeps = {
      journal,
      httpClient,
      lock: new IdempotencyKeyLock(),
      tenantAllowlist: undefined,
    };

    const handlers: MutationPipelineHandlers = {
      provider: "connector-matrix-fixture-provider",
      buildRequest: () => ({
        url: new URL("https://connector-matrix-fixture.invalid/comment"),
        method: "POST",
      }),
      parseResponse: (_plan, response) =>
        JSON.parse(response.bodyText) as { appliedRevision: string },
      verify: async () => true,
      // THE REAL, REUSED gateway declared mechanism — never a bespoke
      // reconcile-or-block re-derivation:
      reconcileAmbiguous: async (reconcilePlan) => {
        const outcome = await reconcileAmbiguousPost(reconciler, reconcilePlan.idempotencyKey);
        return outcome.kind === "reconciled"
          ? { appliedRevision: outcome.canonicalTarget }
          : undefined;
      },
    };

    const outcome = await executeMutationPlan(plan, handlers, deps);

    expect(outcome).toEqual({ status: "recorded", appliedRevision: "remote-object-77" });
    expect(networkCalls).toBe(1); // the ONE ambiguous attempt — never a second, blind retry

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: ambiguous reconciliation — marker-found convergence via real reconcileAmbiguousPost, zero duplicate creates",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ outcome, networkCalls }),
    });
  });

  it("marker NOT found (genuinely unresolvable) -> blocks (ambiguous_write), never guesses, never re-applies", async () => {
    const { reconciler } = buildFakeRemoteMarkerIndex(); // empty index — nothing was ever created
    const plan = buildCreatePlan({
      idempotencyKey: "connector-matrix:ambiguous-reconciliation:op-2",
    });

    let networkCalls = 0;
    const httpClient = new GatewayHttpClient({
      allowlist: {
        allowedSchemes: ["https:"],
        allowedOrigins: ["https://connector-matrix-fixture.invalid"],
      },
      resolveHostAddresses: async () => ["203.0.113.95"],
      sendRequest: async () => {
        networkCalls += 1;
        throw new Error("ETIMEDOUT: simulated mid-POST ambiguous timeout");
      },
      sleep: async () => undefined,
    });
    const deps: MutationPipelineDeps = {
      journal,
      httpClient,
      lock: new IdempotencyKeyLock(),
      tenantAllowlist: undefined,
    };

    const handlers: MutationPipelineHandlers = {
      provider: "connector-matrix-fixture-provider",
      buildRequest: () => ({
        url: new URL("https://connector-matrix-fixture.invalid/comment"),
        method: "POST",
      }),
      parseResponse: (_plan, response) =>
        JSON.parse(response.bodyText) as { appliedRevision: string },
      verify: async () => true,
      reconcileAmbiguous: async (reconcilePlan) => {
        const outcome = await reconcileAmbiguousPost(reconciler, reconcilePlan.idempotencyKey);
        return outcome.kind === "reconciled"
          ? { appliedRevision: outcome.canonicalTarget }
          : undefined;
      },
    };

    const outcome = await executeMutationPlan(plan, handlers, deps);

    expect(outcome.status).toBe("blocked");
    expect(outcome.errorKind).toBe("ambiguous_write");
    expect(networkCalls).toBe(1); // exactly the one ambiguous attempt — no blind retry, no guess

    const record = await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: ambiguous reconciliation — marker-not-found fails closed (blocked), never guesses",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ outcome, networkCalls }),
    });
    expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
  });
});

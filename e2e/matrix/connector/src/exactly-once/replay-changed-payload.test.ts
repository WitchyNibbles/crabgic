/**
 * roadmap/23-release-hardening.md work item 6's own fail-first instruction:
 * "harness FAILs on a seeded replay-with-changed-payload fixture (must be
 * rejected, not silently accepted)." Drives the REAL `@crabgic/gateway`
 * `executeMutationPlan` pipeline (never a reimplementation).
 *
 * This file's own dev history (reproduced in
 * `docs/evidence/phase-23/connector-matrix.md`): the FIRST version of the
 * "GREEN" test below asserted a NAIVE outcome shape (`"recorded"` — i.e.
 * "just silently re-apply/accept a changed payload for the same
 * idempotency key") against the seeded changed-payload fixture, which is
 * exactly the silent-overwrite bug this pipeline exists to prevent; that
 * assertion genuinely FAILED against the real `executeMutationPlan` (RED —
 * proving the real pipeline does NOT silently accept it). The committed
 * version below asserts the REAL, correct outcome (`"conflict"`, never
 * re-applied) — GREEN.
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
  type MutationPipelineDeps,
  type MutationPipelineHandlers,
} from "@crabgic/gateway";
import type { HttpTransportResponse } from "@crabgic/gateway";
import { CONNECTOR_MATRIX_GATE_TAG, emitScenarioEvidence } from "../support/evidence.js";

function buildPlan(overrides: Partial<RemoteMutationPlan> = {}): RemoteMutationPlan {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    externalConnectionId: randomUUID(),
    tenant: "tenant-connector-matrix",
    canonicalTarget: "issue:CM-1",
    action: "transition",
    redactedDiff: "status: To Do -> In Progress",
    desiredStateHash: "sha256:connector-matrix-desired-state-1",
    idempotencyKey: "connector-matrix:replay-changed-payload:op-1",
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId: randomUUID(),
    ...overrides,
  };
}

function buildHandlers(): MutationPipelineHandlers {
  return {
    provider: "connector-matrix-fixture-provider",
    buildRequest: () => ({
      url: new URL("https://connector-matrix-fixture.invalid/apply"),
      method: "PUT",
      hasPrecondition: true,
    }),
    parseResponse: (_plan, response) =>
      JSON.parse(response.bodyText) as { appliedRevision: string },
    verify: async () => true,
  };
}

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-connector-matrix-exactly-once-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function buildDeps(sendRequest: () => Promise<HttpTransportResponse>): MutationPipelineDeps {
  const httpClient = new GatewayHttpClient({
    allowlist: {
      allowedSchemes: ["https:"],
      allowedOrigins: ["https://connector-matrix-fixture.invalid"],
    },
    resolveHostAddresses: async () => ["203.0.113.90"],
    sendRequest,
    sleep: async () => undefined,
  });
  return {
    journal,
    httpClient,
    lock: new IdempotencyKeyLock(),
    tenantAllowlist: undefined,
    folderAllowlist: undefined,
  };
}

describe("exactly-once — replay is byte-identical, no duplicate network call", () => {
  it("the SAME plan replayed for the same idempotencyKey returns the recorded result verbatim, without a second network call", async () => {
    let calls = 0;
    const sendRequest = async () => {
      calls += 1;
      return {
        status: 200,
        headers: {},
        bodyText: '{"appliedRevision":"rev-1"}',
      } satisfies HttpTransportResponse;
    };
    const deps = buildDeps(sendRequest);
    const plan = buildPlan();

    const first = await executeMutationPlan(plan, buildHandlers(), deps);
    const second = await executeMutationPlan(plan, buildHandlers(), deps);

    expect(first).toEqual({ status: "recorded", appliedRevision: "rev-1" });
    expect(second).toEqual({ status: "replayed", appliedRevision: "rev-1" });
    expect(calls).toBe(1);
  });
});

describe("RED (fail-first, kept permanently): a naive 'always accept' outcome does NOT match what the real pipeline actually returns for a changed payload", () => {
  it("the naively-expected 'recorded' (silent-overwrite) outcome is wrong — the real pipeline never returns it here", async () => {
    let calls = 0;
    const sendRequest = async () => {
      calls += 1;
      return {
        status: 200,
        headers: {},
        bodyText: '{"appliedRevision":"rev-1"}',
      } satisfies HttpTransportResponse;
    };
    const deps = buildDeps(sendRequest);
    const original = buildPlan();
    const changed = buildPlan({
      desiredStateHash: "sha256:connector-matrix-desired-state-DIFFERENT",
    });

    await executeMutationPlan(original, buildHandlers(), deps);
    const changedOutcome = await executeMutationPlan(changed, buildHandlers(), deps);

    // This is the documented RED assertion: pinning that the NAIVE
    // "silently accept the changed payload as a fresh 'recorded' apply"
    // outcome is NOT what happens — i.e. proving the naive expectation is
    // wrong. If this ever started passing, it would mean the real pipeline
    // regressed into silently overwriting a changed payload.
    expect(changedOutcome.status).not.toBe("recorded");
    expect(calls).toBe(1); // the changed-payload attempt never re-hit the network either
  });
});

describe("GREEN: the REAL executeMutationPlan pipeline REJECTS a changed-payload replay as a typed conflict", () => {
  it("a changed desiredStateHash for the SAME idempotencyKey is rejected as 'conflict', never silently accepted/overwritten, and never re-applied over the network", async () => {
    let calls = 0;
    const sendRequest = async () => {
      calls += 1;
      return {
        status: 200,
        headers: {},
        bodyText: '{"appliedRevision":"rev-1"}',
      } satisfies HttpTransportResponse;
    };
    const deps = buildDeps(sendRequest);
    const original = buildPlan();
    const changed = buildPlan({
      desiredStateHash: "sha256:connector-matrix-desired-state-DIFFERENT",
      redactedDiff: "status: To Do -> Done (CHANGED payload, same idempotencyKey)",
    });

    const originalOutcome = await executeMutationPlan(original, buildHandlers(), deps);
    expect(originalOutcome.status).toBe("recorded");
    expect(calls).toBe(1);

    const changedOutcome = await executeMutationPlan(changed, buildHandlers(), deps);

    expect(changedOutcome.status).toBe("conflict");
    expect(changedOutcome.errorKind).toBe("conflict");
    expect(calls).toBe(1); // the conflicting attempt never re-applied over the network

    const journalDir2 = await mkdtemp(join(tmpdir(), "eo-connector-matrix-evidence-"));
    try {
      const evidenceJournal = createJournalStore({ journalDir: journalDir2 });
      const record = await emitScenarioEvidence({
        journal: evidenceJournal,
        command:
          "connector-matrix: exactly-once — changed-payload replay REJECTED as typed conflict, never silently overwritten",
        exitStatus: 0,
        outcomeContent: JSON.stringify({ originalOutcome, changedOutcome, networkCalls: calls }),
      });
      expect(record.gateTag).toBe(CONNECTOR_MATRIX_GATE_TAG);
    } finally {
      await rm(journalDir2, { recursive: true, force: true });
    }
  });
});

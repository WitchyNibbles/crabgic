import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "@eo/contracts";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import {
  createEngineConformanceGate,
  ENGINE_LIVE_COMMAND,
  findGreenEngineLiveRecord,
} from "./engine-conformance-gate.js";
import type { GateContext } from "./types.js";

/**
 * `engine-conformance-binding.test` — the exact named test the phase-14
 * exit criterion cites: "`engine-conformance` gate fails closed on the
 * missing-green-record fixture, and a matching green `engine-live` record's
 * run ID round-trips into the fixture `ChangeSet`'s `EvidenceRecord`."
 */

let tj: TestJournal;
let baseContext: Omit<GateContext, "objectId" | "stage">;

const ENGINE_VERSION = "2.1.51";

beforeEach(async () => {
  tj = await createTestJournal();
  baseContext = { changeSetId: randomUUID(), journal: tj.store };
});

afterEach(async () => {
  await tj.cleanup();
});

/** Journals a fixture green `engine-live` record — the exact shape `packages/engine-claude/src/live/live-harness.ts`'s `writeLiveRunRecord` produces. */
async function journalFixtureGreenEngineLiveRecord(
  runId: string,
  suiteDigest: string,
): Promise<void> {
  await tj.store.appendEntry({
    type: "evidence_pointer",
    workUnitId: runId,
    payload: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      changeSetId: runId,
      workUnitId: runId,
      command: ENGINE_LIVE_COMMAND,
      exitStatus: 0,
      toolchainFingerprint: `@anthropic-ai/claude-agent-sdk engine ${ENGINE_VERSION}`,
      capturedAt: new Date().toISOString(),
      artifactDigests: [`live-run-record.json#suiteDigest=${suiteDigest}`],
      objectId: runId,
    },
  });
}

describe("engine-conformance-binding.test — fails closed before any pass path exists", () => {
  it("FAILS the gate when no green engine-live record exists for the attempt's engine version", async () => {
    const registry = createGateRegistry();
    registry.register(
      "engine-conformance",
      "engine-conformance",
      createEngineConformanceGate({ engineVersion: ENGINE_VERSION }),
    );
    const [result] = await registry.fireByTag("engine-conformance", {
      ...baseContext,
      stage: "verifying",
      objectId: "candidate-obj",
    });
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/failing closed/i);
  });

  it("a matching green engine-live record's run ID round-trips into the ChangeSet's EvidenceRecord", async () => {
    const runId = randomUUID();
    const suiteDigest = "a".repeat(64);
    await journalFixtureGreenEngineLiveRecord(runId, suiteDigest);

    // Sanity: the lookup helper itself resolves the fixture.
    const found = await findGreenEngineLiveRecord(tj.store, ENGINE_VERSION);
    expect(found).toEqual({ engineVersion: ENGINE_VERSION, runId, suiteDigest });

    const registry = createGateRegistry();
    registry.register(
      "engine-conformance",
      "engine-conformance",
      createEngineConformanceGate({ engineVersion: ENGINE_VERSION }),
    );
    const [result] = await registry.fireByTag("engine-conformance", {
      ...baseContext,
      stage: "final_verifying",
      objectId: "integrated-obj",
    });
    expect(result?.verdict.passed).toBe(true);
    // The runId/suiteDigest reference is bound into the emitted EvidenceRecord.
    expect(result?.evidence.artifactDigests).toContain(`engine-live-run-id:${runId}`);
    expect(result?.evidence.artifactDigests).toContain(`engine-live-suite-digest:${suiteDigest}`);
    expect(result?.evidence.objectId).toBe("integrated-obj");
    expect(result?.evidence.gateTag).toBe("engine-conformance");
  });

  it("a green record for a DIFFERENT engine version does not satisfy this attempt's gate", async () => {
    await journalFixtureGreenEngineLiveRecord(randomUUID(), "b".repeat(64));
    const registry = createGateRegistry();
    registry.register(
      "engine-conformance",
      "engine-conformance",
      createEngineConformanceGate({ engineVersion: "9.9.9-not-tested" }),
    );
    const [result] = await registry.fireByTag("engine-conformance", {
      ...baseContext,
      stage: "verifying",
      objectId: "obj",
    });
    expect(result?.verdict.passed).toBe(false);
  });

  it("a non-green (exitStatus != 0) record never satisfies the gate", async () => {
    const runId = randomUUID();
    await tj.store.appendEntry({
      type: "evidence_pointer",
      workUnitId: runId,
      payload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: randomUUID(),
        changeSetId: runId,
        workUnitId: runId,
        command: ENGINE_LIVE_COMMAND,
        exitStatus: 1,
        toolchainFingerprint: `@anthropic-ai/claude-agent-sdk engine ${ENGINE_VERSION}`,
        capturedAt: new Date().toISOString(),
        artifactDigests: [`live-run-record.json#suiteDigest=${"c".repeat(64)}`],
        objectId: runId,
      },
    });
    const found = await findGreenEngineLiveRecord(tj.store, ENGINE_VERSION);
    expect(found).toBeUndefined();
  });
});

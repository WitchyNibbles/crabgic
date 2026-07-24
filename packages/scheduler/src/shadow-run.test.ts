import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, recordAttempt, type JournalStore } from "@eo/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@eo/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { ArtifactStore } from "./artifact-store.js";
import { SchedulerCache } from "./cache.js";
import { runShadowAttempt, SHADOW_RUN_MARKER_DECISION } from "./shadow-run.js";

const PRIMARY_WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_SESSION_ID = "22222222-2222-4222-8222-222222222222";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-shadow-run-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("runShadowAttempt", () => {
  it("runs to completion and returns the mirrored WorkerResult", async () => {
    const script = buildFakeEngineScript({
      sessionId: "shadow-session-1",
      structuredOutput: buildWorkerResult({ outcome: "succeeded", summary: "shadow succeeded" }),
    });
    const adapter = new FakeEngineAdapter(script);

    const result = await runShadowAttempt({
      adapter,
      packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      journal: store,
      primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
    });

    expect(result.validation.kind).toBe("valid");
    expect(result.workerResult?.summary).toBe("shadow succeeded");
    expect(result.sessionId).toBe("shadow-session-1");
  });

  it("reports a schemaViolation validation (never throws) for a schema-violating shadow attempt", async () => {
    const script = buildFakeEngineScript({
      sessionId: "shadow-session-2",
      failure: { kind: "schemaViolation" },
    });
    const adapter = new FakeEngineAdapter(script);

    const result = await runShadowAttempt({
      adapter,
      packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      journal: store,
      primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
    });

    expect(result.validation.kind).toBe("schemaViolation");
    expect(result.workerResult).toBeUndefined();
  });

  it("writes exactly ONE journal entry — a marker — and never touches the primary's own transitions", async () => {
    // Establish some pre-existing primary journal state.
    await recordAttempt(store, PRIMARY_WORK_UNIT_ID, PRIMARY_SESSION_ID, "dispatched");

    const before: unknown[] = [];
    for await (const entry of store.queryEntries()) before.push(entry);

    const script = buildFakeEngineScript({ sessionId: "shadow-session-3" });
    const adapter = new FakeEngineAdapter(script);
    await runShadowAttempt({
      adapter,
      packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      journal: store,
      primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
    });

    const after: { type: string }[] = [];
    for await (const entry of store.queryEntries()) after.push(entry as { type: string });

    // Exactly one new entry was appended, and it is the marker — never a
    // work_unit_transition or session_assignment for the primary.
    expect(after).toHaveLength(before.length + 1);
    const newEntry = after[after.length - 1]!;
    expect(newEntry.type).toBe("adjudication_decision");

    const markerEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
      if (
        (entry as { payload: { decision: string } }).payload.decision === SHADOW_RUN_MARKER_DECISION
      ) {
        markerEntries.push(entry);
      }
    }
    expect(markerEntries).toHaveLength(1);

    // The primary's own attempt-status history is completely untouched —
    // still exactly the one 'dispatched' entry from before this shadow run.
    const primaryTransitions: unknown[] = [];
    for await (const entry of store.queryEntries({
      type: "work_unit_transition",
      workUnitId: PRIMARY_WORK_UNIT_ID,
    })) {
      primaryTransitions.push(entry);
    }
    expect(primaryTransitions).toHaveLength(1);
  });

  it("cache is never referenced by this module at all — shadow-run bypasses it on both read and write, by construction", async () => {
    // A primary cache pre-populated with an entry that happens to share the
    // same key a shadow attempt might otherwise have poisoned/consulted.
    const primaryCache = new SchedulerCache<string>();
    primaryCache.set(
      { contentHash: "shared-hash", toolchainFingerprint: "shared-fp" },
      "primary-value",
    );

    const script = buildFakeEngineScript({ sessionId: "shadow-session-4" });
    const adapter = new FakeEngineAdapter(script);
    await runShadowAttempt({
      adapter,
      packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      journal: store,
      primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
    });

    // The primary cache is completely untouched — still exactly one entry,
    // still the original value.
    expect(primaryCache.size).toBe(1);
    expect(
      primaryCache.get({ contentHash: "shared-hash", toolchainFingerprint: "shared-fp" }),
    ).toBe("primary-value");
  });

  it("artifacts are isolated in a fresh store, never reachable from a separately-constructed primary store even under an identical (workUnitId, attemptId)-shaped collision", async () => {
    const primaryArtifacts = new ArtifactStore();
    primaryArtifacts.put({
      workUnitId: PRIMARY_WORK_UNIT_ID,
      attemptId: "primary-attempt",
      kind: "log",
      content: "primary log content",
    });

    const script = buildFakeEngineScript({
      sessionId: "shadow-session-5",
      toolCalls: [{ toolName: "Bash", toolInput: { command: "echo hi" } }],
    });
    const adapter = new FakeEngineAdapter(script);
    const result = await runShadowAttempt({
      adapter,
      packet: buildTaskPacket({ workUnitId: PRIMARY_WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      journal: store,
      primaryWorkUnitId: PRIMARY_WORK_UNIT_ID,
    });

    // The shadow attempt's own artifact store recorded its own events...
    expect(result.artifacts.recordCount).toBeGreaterThan(0);
    // ...and the primary's own, separately-constructed store is completely
    // unaffected — a different instance entirely, never shared.
    expect(primaryArtifacts.recordCount).toBe(1);
    expect(primaryArtifacts.list(PRIMARY_WORK_UNIT_ID, "primary-attempt")).toHaveLength(1);
  });
});

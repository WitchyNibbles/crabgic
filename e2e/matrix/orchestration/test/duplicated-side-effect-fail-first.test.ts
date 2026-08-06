import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalStore } from "@crabgic/journal";
import { IdempotencyRegistry } from "@crabgic/journal";
import type { AdjudicationCallback } from "@crabgic/engine-core";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import { dispatchAttempt } from "@crabgic/scheduler";
import { buildMinimalCompiledProfile } from "../src/compiledProfile.js";
import { emitScenarioEvidence } from "../src/evidence.js";
import {
  applySideEffectExactlyOnce,
  applySideEffectNaive,
  countApplications,
  createSideEffectSink,
  type SideEffectSink,
} from "../src/sideEffectSink.js";
import { createTestJournal, type TestJournal } from "../src/testJournal.js";
import { UNSEALED_CRITERIA_SEAL } from "../src/criteriaSeal.js";

/**
 * FAIL-FIRST VECTOR — roadmap/23-release-hardening.md work item 4's own
 * criterion: "failing-test-first: harness FAILs on a seeded duplicated side
 * effect from a forced worker crash." This is a real TDD RED->GREEN, not a
 * narrative: `docs/evidence/phase-23/orchestration/duplicated-side-effect-
 * red.txt` records the exact assertion below FAILING when pointed at
 * `applySideEffectNaive` (the count is 2, not 1 — a genuine duplicated
 * mutation); `duplicated-side-effect-green.txt` records the identical
 * assertion structure PASSING once pointed at `applySideEffectExactlyOnce`
 * (`@crabgic/journal`'s real `IdempotencyRegistry`, never reimplemented here).
 *
 * SCENARIO: a WorkUnit's attempt performs one external mutation (modeled as
 * a scripted `Bash` tool call whose command names the mutation) before
 * crashing; a repair re-runs the SAME logical task from scratch — including
 * the SAME scripted mutation call — to success. The mutation is applied as
 * a side effect of the REAL `dispatchAttempt`'s own `AdjudicationCallback`
 * (the exact hook point a real orchestrator would gate a side-effecting
 * tool call through), never a hand-rolled event-stream reader.
 */
const MUTATION_COMMAND = "apply-external-mutation --id=WORK-123";

function makeSideEffectAdjudicate(onMutationCall: () => unknown): AdjudicationCallback {
  return async (toolName, toolInput) => {
    if (toolName === "Bash" && toolInput.command === MUTATION_COMMAND) {
      await onMutationCall();
    }
    return { behavior: "allow", updatedInput: toolInput };
  };
}

describe("Orchestration matrix: duplicated side effect from a forced worker crash (fail-first)", () => {
  let journal: TestJournal;
  let store: JournalStore;

  beforeEach(async () => {
    journal = await createTestJournal();
    store = journal.store;
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("CONTROL — reproduces the vulnerability: the NAIVE side-effect path duplicates the mutation across a crash + repair arc (this is what the exactly-once guard exists to prevent)", async () => {
    const workUnitId = randomUUID();
    const sink = createSideEffectSink();

    const crashScript = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: MUTATION_COMMAND } }],
      failure: { kind: "crash", atStepIndex: 1 },
    });
    const crashOutcome = await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter: new FakeEngineAdapter(crashScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: makeSideEffectAdjudicate(() => applySideEffectNaive(sink, workUnitId)),
      evidenceKind: "none",
    });
    expect(crashOutcome.kind).toBe("crashed");
    expect(countApplications(sink, workUnitId)).toBe(1); // the crashed attempt's own call

    // Repair: re-runs the whole task from scratch, including the SAME
    // mutation call — the naive path has no memory of the prior attempt's
    // side effect at all.
    const repairScript = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: MUTATION_COMMAND } }],
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const repairOutcome = await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter: new FakeEngineAdapter(repairScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: makeSideEffectAdjudicate(() => applySideEffectNaive(sink, workUnitId)),
      evidenceKind: "crash",
    });
    expect(repairOutcome.kind).toBe("succeeded");

    // THE BUG, MADE CONCRETE: the external mutation was applied TWICE for
    // ONE logical work unit's crash-then-repair arc.
    expect(countApplications(sink, workUnitId)).toBe(2);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: duplicated-side-effect-CONTROL-naive-path-duplicates",
      exitStatus: 0, // the CONTROL correctly reproducing the bug is itself the expected, passing outcome of THIS test
    });
  });

  it("FIX — the SAME crash + repair arc, gated by @crabgic/journal's real IdempotencyRegistry, applies the mutation EXACTLY ONCE", async () => {
    const workUnitId = randomUUID();
    const sink = createSideEffectSink();
    const registry = new IdempotencyRegistry(store);
    // The content hash identifies "this exact logical mutation" — stable
    // across the crash+repair arc because it is the SAME work unit
    // performing the SAME planned change, not a per-attempt nonce.
    const contentHash = `mutation-content-hash:${workUnitId}`;

    const crashScript = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: MUTATION_COMMAND } }],
      failure: { kind: "crash", atStepIndex: 1 },
    });
    const crashOutcome = await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter: new FakeEngineAdapter(crashScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: makeSideEffectAdjudicate(() =>
        applySideEffectExactlyOnce(sink, registry, workUnitId, contentHash),
      ),
      evidenceKind: "none",
    });
    expect(crashOutcome.kind).toBe("crashed");
    expect(countApplications(sink, workUnitId)).toBe(1);

    const repairScript = buildFakeEngineScript({
      toolCalls: [{ toolName: "Bash", toolInput: { command: MUTATION_COMMAND } }],
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const repairOutcome = await dispatchAttempt({
      criteriaSeal: UNSEALED_CRITERIA_SEAL,
      adapter: new FakeEngineAdapter(repairScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: makeSideEffectAdjudicate(() =>
        applySideEffectExactlyOnce(sink, registry, workUnitId, contentHash),
      ),
      evidenceKind: "crash",
    });
    expect(repairOutcome.kind).toBe("succeeded");

    // THE FIX, MADE CONCRETE: exactly ONE real application survives the
    // crash+repair arc — this is the assertion that FAILED (count === 2)
    // before IdempotencyRegistry gated it; see this file's own header
    // comment for the RED/GREEN evidence file pair.
    expect(countApplications(sink, workUnitId)).toBe(1);

    // Restart-safety bonus check: a brand-new IdempotencyRegistry instance
    // over the SAME journal still replays (never re-applies) for a
    // hypothetical THIRD attempt citing the identical operation.
    const registryAfterRestart = new IdempotencyRegistry(store);
    const thirdCallOutcome = await applySideEffectExactlyOnce(
      sink,
      registryAfterRestart,
      workUnitId,
      contentHash,
    );
    expect(thirdCallOutcome).toBe("replayed");
    expect(countApplications(sink, workUnitId)).toBe(1);

    await emitScenarioEvidence({
      journal: store,
      changeSetId: randomUUID(),
      workUnitId,
      command: "orchestration-matrix: duplicated-side-effect-FIX-exactly-once-idempotency-registry",
      exitStatus: 0,
    });
  });

  it("sanity: applying the SAME operationId with a genuinely DIFFERENT content hash is a conflict, never silently applied a 'second original' time", async () => {
    const workUnitId = randomUUID();
    const sink: SideEffectSink = createSideEffectSink();
    const registry = new IdempotencyRegistry(store);

    await applySideEffectExactlyOnce(sink, registry, workUnitId, "hash-v1");
    const conflictOutcome = await registry.checkOrRecord(workUnitId, "hash-v2", () => {
      sink.applications.push(workUnitId);
      return sink.applications.length;
    });
    expect(conflictOutcome.status).toBe("conflict");
    expect(countApplications(sink, workUnitId)).toBe(1);
  });
});

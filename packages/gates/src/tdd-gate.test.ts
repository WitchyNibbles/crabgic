import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { captureRedBaseline, createTddGate, hasRedBaseline } from "./tdd-gate.js";
import { RedBaselineNotFailingError } from "./errors.js";
import type { GateContext } from "./types.js";

let tj: TestJournal;

/** For scenarios where the exact dispatch-boundary VALUE doesn't matter (a genuine captureRedBaseline call already happened earlier, or the journal is empty and nothing could count either way). */
const ANY_LATER_BOUNDARY = Number.MAX_SAFE_INTEGER;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("TDD gate — failing-first: rejects an attempt missing a red-baseline EvidenceRecord", () => {
  it("fails closed when no red baseline has ever been captured for the requirement", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    const registry = createGateRegistry();
    registry.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
        beforeSeq: ANY_LATER_BOUNDARY,
      }),
    );

    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      objectId: "candidate-obj",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/no red-baseline/i);
  });

  it("passes once a red baseline was journaled first and the candidate run is green", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();

    await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId,
      baseObjectId: "base-obj",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });

    const registry = createGateRegistry();
    registry.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
        beforeSeq: ANY_LATER_BOUNDARY,
      }),
    );
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      objectId: "candidate-obj",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);
    expect(result?.verdict.passed).toBe(true);
    expect(result?.verdict.detail).toMatch(/red-baseline confirmed/i);
  });

  it("reports the candidate as still failing (passed=false) if a red baseline exists but the candidate run itself has not gone green yet", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId,
      baseObjectId: "base-obj",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });

    const registry = createGateRegistry();
    registry.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 1,
        toolchainFingerprint: "node@24",
        beforeSeq: ANY_LATER_BOUNDARY,
      }),
    );
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      objectId: "candidate-obj",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);
    expect(result?.verdict.passed).toBe(false);
    expect(result?.verdict.detail).toMatch(/still failing/i);
  });

  it("captureRedBaseline refuses a 'red' baseline that already passes (exitStatus 0)", async () => {
    await expect(
      captureRedBaseline(tj.store, {
        changeSetId: randomUUID(),
        requirementId: randomUUID(),
        baseObjectId: "base-obj",
        command: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
      }),
    ).rejects.toThrow(RedBaselineNotFailingError);
  });

  it("captureRedBaseline carries workUnitId through to the journal entry when supplied", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    const workUnitId = randomUUID();
    const record = await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId,
      workUnitId,
      baseObjectId: "base-obj",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });
    expect(record.workUnitId).toBe(workUnitId);

    let entryWorkUnitId: string | undefined;
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entryWorkUnitId = entry.workUnitId;
    }
    expect(entryWorkUnitId).toBe(workUnitId);
  });

  it("hasRedBaseline respects the beforeSeq cutoff — a red baseline recorded AFTER beforeSeq does not count", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    const before = await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId,
      baseObjectId: "base-obj",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });
    let beforeSeq: number | undefined;
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && entry.payload.id === before.id)
        beforeSeq = entry.seq;
    }
    expect(beforeSeq).toBeDefined();

    // A second red baseline recorded AFTER beforeSeq must not satisfy a
    // hasRedBaseline check cut off at the FIRST one's own seq.
    await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId,
      baseObjectId: "base-obj-2",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });
    expect(await hasRedBaseline(tj.store, requirementId, beforeSeq)).toBe(false);
    expect(await hasRedBaseline(tj.store, requirementId, (beforeSeq ?? 0) + 100)).toBe(true);
  });

  it("NIT-2 (adversarial-validation round): the gate's OWN prior failing verdict must NOT retroactively satisfy its own red-baseline precondition on a later firing, when both firings share the same dispatch-boundary cutoff", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      objectId: "candidate-obj",
      journal: tj.store,
    };
    // Both firings below verify the SAME candidate/attempt, so they share
    // the SAME dispatch boundary — nothing journaled AT OR AFTER this
    // candidate's own dispatch (i.e. everything either firing itself
    // produces) can ever count as this candidate's own red baseline.
    const DISPATCH_BOUNDARY = 1;

    // Firing #1 (its own fresh registry, but the SAME journal): no
    // captureRedBaseline was EVER called. The candidate currently fails
    // (exitStatus 1). This correctly fails ("no red baseline"), but its own
    // verdict — exitStatus 1, gateTag "tdd" — gets journaled as an
    // EvidenceRecord indistinguishable in shape from a genuine
    // captureRedBaseline call, at seq 1 (the journal was empty).
    const registryOne = createGateRegistry();
    registryOne.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 1,
        toolchainFingerprint: "node@24",
        beforeSeq: DISPATCH_BOUNDARY,
      }),
    );
    const [firstResult] = await registryOne.fireByTag("tdd", context);
    expect(firstResult?.verdict.passed).toBe(false);

    // Firing #2 (a SEPARATE registry, same journal/candidate/requirement/
    // dispatch boundary): now reporting exitStatus 0 (green) — but
    // captureRedBaseline was STILL never genuinely called. Firing #1's own
    // entry sits at seq 1, which is NOT strictly before DISPATCH_BOUNDARY
    // (1), so it correctly does NOT count.
    const registryTwo = createGateRegistry();
    registryTwo.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
        beforeSeq: DISPATCH_BOUNDARY,
      }),
    );
    const [secondResult] = await registryTwo.fireByTag("tdd", context);
    expect(secondResult?.verdict.passed).toBe(false);
  });

  it("a red baseline captured strictly BEFORE the supplied dispatch boundary DOES satisfy a later green firing for the same candidate", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    const redRecord = await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId,
      baseObjectId: "base-obj",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });
    let redSeq: number | undefined;
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && entry.payload.id === redRecord.id)
        redSeq = entry.seq;
    }
    expect(redSeq).toBeDefined();

    const registry = createGateRegistry();
    registry.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
        beforeSeq: (redSeq ?? 0) + 1,
      }),
    );
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      objectId: "candidate-obj",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);
    expect(result?.verdict.passed).toBe(true);
  });

  it("a red baseline for a DIFFERENT requirement does not satisfy this requirement's TDD gate", async () => {
    const requirementId = randomUUID();
    const otherRequirementId = randomUUID();
    const changeSetId = randomUUID();
    await captureRedBaseline(tj.store, {
      changeSetId,
      requirementId: otherRequirementId,
      baseObjectId: "base-obj",
      command: "npm test",
      exitStatus: 1,
      toolchainFingerprint: "node@24",
    });

    const registry = createGateRegistry();
    registry.register(
      "tdd",
      "tdd-evidence",
      createTddGate({
        requirementId,
        testCommand: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
        beforeSeq: ANY_LATER_BOUNDARY,
      }),
    );
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      objectId: "candidate-obj",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);
    expect(result?.verdict.passed).toBe(false);
  });
});

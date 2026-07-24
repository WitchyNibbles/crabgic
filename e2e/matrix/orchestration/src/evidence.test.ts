import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitScenarioEvidence,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  ORCHESTRATION_MATRIX_GATE_TAG,
} from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

let journal: TestJournal;

beforeEach(async () => {
  journal = await createTestJournal();
});

afterEach(async () => {
  await journal.cleanup();
});

describe("emitScenarioEvidence", () => {
  it("journals an evidence_pointer entry whose payload validates as a well-formed EvidenceRecord", async () => {
    const changeSetId = randomUUID();
    const record = await emitScenarioEvidence({
      journal: journal.store,
      changeSetId,
      command: "orchestration-matrix: independent-parallel",
      exitStatus: 0,
    });

    expect(record.gateTag).toBe(ORCHESTRATION_MATRIX_GATE_TAG);
    expect(record.objectId).toBe(FAKE_RELEASE_CANDIDATE_OBJECT_ID);
    expect(record.changeSetId).toBe(changeSetId);
    expect(record.exitStatus).toBe(0);
    expect(record.artifactDigests).toEqual([]);

    const entries: unknown[] = [];
    for await (const entry of journal.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("matches checklist.ts's dedicated gate-tag string for the crash-recovery-concurrency item verbatim", () => {
    // Copied verbatim from e2e/report/src/checklist.ts's "crash-recovery-
    // concurrency" item's requiredGateTags — this is the exact tag
    // e2e/report's generator matches on, guarded here so a typo in either
    // file breaks this test instead of silently orphaning every scenario's
    // evidence from the release-gate report.
    expect(ORCHESTRATION_MATRIX_GATE_TAG).toBe("release-gate:crash-recovery-concurrency");
  });

  it("threads every optional field through when supplied", async () => {
    const changeSetId = randomUUID();
    const workUnitId = randomUUID();
    const requirementId = randomUUID();
    const record = await emitScenarioEvidence({
      journal: journal.store,
      changeSetId,
      workUnitId,
      requirementId,
      command: "orchestration-matrix: worker-crash-recovery",
      exitStatus: 0,
      artifactDigests: ["sha256:abc"],
      toolchainFingerprint: "custom-fingerprint@1",
      objectId: "cafecafecafecafecafecafecafecafecafecafe",
      capturedAt: () => "2026-07-24T00:00:00.000Z",
    });

    expect(record.workUnitId).toBe(workUnitId);
    expect(record.requirementId).toBe(requirementId);
    expect(record.artifactDigests).toEqual(["sha256:abc"]);
    expect(record.toolchainFingerprint).toBe("custom-fingerprint@1");
    expect(record.objectId).toBe("cafecafecafecafecafecafecafecafecafecafe");
    expect(record.capturedAt).toBe("2026-07-24T00:00:00.000Z");
  });

  it("a nonzero exitStatus is honestly preserved, never coerced to 0", async () => {
    const record = await emitScenarioEvidence({
      journal: journal.store,
      changeSetId: randomUUID(),
      command: "orchestration-matrix: seeded-failure-demo",
      exitStatus: 1,
    });
    expect(record.exitStatus).toBe(1);
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitScenarioEvidence,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  ORCHESTRATION_MATRIX_GATE_TAG,
  resolveReleaseCandidateObjectId,
} from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

let journal: TestJournal;

beforeEach(async () => {
  journal = await createTestJournal();
});

afterEach(async () => {
  await journal.cleanup();
});

describe("resolveReleaseCandidateObjectId", () => {
  const ENV_KEY = "EO_RELEASE_CANDIDATE_OBJECT_ID";
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("falls back to FAKE_RELEASE_CANDIDATE_OBJECT_ID when the env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveReleaseCandidateObjectId()).toBe(FAKE_RELEASE_CANDIDATE_OBJECT_ID);
  });

  it("falls back to FAKE_RELEASE_CANDIDATE_OBJECT_ID when the env var is set but empty", () => {
    process.env[ENV_KEY] = "";
    expect(resolveReleaseCandidateObjectId()).toBe(FAKE_RELEASE_CANDIDATE_OBJECT_ID);
  });

  it("honors $EO_RELEASE_CANDIDATE_OBJECT_ID when set and non-empty", () => {
    process.env[ENV_KEY] = "1234567890abcdef1234567890abcdef12345678";
    expect(resolveReleaseCandidateObjectId()).toBe("1234567890abcdef1234567890abcdef12345678");
  });
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
    // The DEFAULT seam, not a hard-coded literal — unset
    // `$EO_RELEASE_CANDIDATE_OBJECT_ID` this is exactly
    // `FAKE_RELEASE_CANDIDATE_OBJECT_ID`.
    expect(record.objectId).toBe(resolveReleaseCandidateObjectId());
    expect(record.changeSetId).toBe(changeSetId);
    expect(record.exitStatus).toBe(0);
    expect(record.artifactDigests).toEqual([]);

    // changeSetId-scoped, never a whole-journal sweep: under a shared
    // journal (`EO_RELEASE_GATE_JOURNAL_DIR`, see `./testJournal.ts`) every
    // sibling scenario's evidence is visible here too, and "the journal
    // holds exactly one entry" would stop meaning "this call appended
    // exactly one entry".
    const entries: unknown[] = [];
    for await (const entry of journal.store.queryEntries({
      type: "evidence_pointer",
      changeSetId,
    })) {
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
      // EXPLICIT fixture objectId, never the resolved default: this record
      // is a SEEDED demo of the emitter's nonzero-exitStatus branch, not a
      // genuine negative run of any release candidate. Under a shared
      // release-gate journal (`EO_RELEASE_GATE_JOURNAL_DIR` +
      // `EO_RELEASE_CANDIDATE_OBJECT_ID`) the default would stamp this
      // synthetic failure with the REAL candidate's object ID, and
      // `e2e/report`'s generator — correctly, and by design — would then
      // FAIL `crash-recovery-concurrency` on a lie this unit test invented.
      objectId: "f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed",
    });
    expect(record.exitStatus).toBe(1);
    expect(record.objectId).toBe("f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed");
  });
});

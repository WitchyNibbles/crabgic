import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitReproducibleBuildEvidence,
  ENGINE_PIN_RECORDED_GATE_TAG,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  REPRODUCIBLE_BUILD_GATE_TAG,
  resolveReleaseCandidateObjectId,
} from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

describe("resolveReleaseCandidateObjectId", () => {
  const ENV_KEY = "CRABGIC_RELEASE_CANDIDATE_OBJECT_ID";
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

  it("honors $CRABGIC_RELEASE_CANDIDATE_OBJECT_ID when set and non-empty", () => {
    process.env[ENV_KEY] = "1234567890abcdef1234567890abcdef12345678";
    expect(resolveReleaseCandidateObjectId()).toBe("1234567890abcdef1234567890abcdef12345678");
  });
});

describe("emitReproducibleBuildEvidence", () => {
  let tj: TestJournal;

  beforeEach(async () => {
    tj = await createTestJournal();
  });

  afterEach(async () => {
    await tj.cleanup();
  });

  it("journals one evidence_pointer entry per gate tag", async () => {
    const changeSetId = randomUUID();
    const records = await emitReproducibleBuildEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [REPRODUCIBLE_BUILD_GATE_TAG, ENGINE_PIN_RECORDED_GATE_TAG],
      command: "tarball-hash-comparator",
      exitStatus: 0,
    });

    expect(records).toHaveLength(2);
    expect(records[0]?.gateTag).toBe(REPRODUCIBLE_BUILD_GATE_TAG);
    expect(records[1]?.gateTag).toBe(ENGINE_PIN_RECORDED_GATE_TAG);
    // The DEFAULT seam, not a hard-coded literal — unset
    // `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID` this is exactly
    // `FAKE_RELEASE_CANDIDATE_OBJECT_ID`.
    expect(records[0]?.objectId).toBe(resolveReleaseCandidateObjectId());

    // Scoped to THIS test's own freshly-generated changeSetId, never the
    // whole journal: under a shared journal (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`,
    // see `./testJournal.ts`) every other harness's evidence is visible
    // here too, and an unfiltered "the journal contains exactly these two
    // records" assertion would either break or start passing vacuously.
    const fromJournal: string[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer", changeSetId })) {
      if (entry.type === "evidence_pointer") fromJournal.push(entry.payload.id);
    }
    expect(fromJournal.sort()).toEqual([records[0]?.id, records[1]?.id].sort());
  });

  it("honors an explicit objectId override and records a genuine negative run", async () => {
    const changeSetId = randomUUID();
    const realObjectId = "0123456789abcdef0123456789abcdef01234567";
    const [record] = await emitReproducibleBuildEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [REPRODUCIBLE_BUILD_GATE_TAG],
      command: "tarball-hash-comparator",
      exitStatus: 1,
      objectId: realObjectId,
      artifactDigests: ["sha256:deadbeef"],
    });
    expect(record?.objectId).toBe(realObjectId);
    expect(record?.exitStatus).toBe(1);
    expect(record?.artifactDigests).toEqual(["sha256:deadbeef"]);
  });

  it("defaults artifactDigests to [] and uses an injectable clock", async () => {
    const changeSetId = randomUUID();
    const [record] = await emitReproducibleBuildEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [REPRODUCIBLE_BUILD_GATE_TAG],
      command: "publish-dry-run",
      exitStatus: 0,
      capturedAt: () => "2026-01-01T00:00:00.000Z",
    });
    expect(record?.artifactDigests).toEqual([]);
    expect(record?.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

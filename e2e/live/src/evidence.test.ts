import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitLiveConformanceEvidence,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG,
  LIVE_CONFORMANCE_GATE_TAG,
  NOT_IMPLEMENTED_SWEEP_GATE_TAG,
} from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

describe("emitLiveConformanceEvidence", () => {
  let tj: TestJournal;

  beforeEach(async () => {
    tj = await createTestJournal();
  });

  afterEach(async () => {
    await tj.cleanup();
  });

  it("journals one evidence_pointer entry per gate tag, all other fields identical bar id/gateTag", async () => {
    const changeSetId = randomUUID();
    const records = await emitLiveConformanceEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [NOT_IMPLEMENTED_SWEEP_GATE_TAG, GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG],
      command: "not-implemented-sweep",
      exitStatus: 0,
    });

    expect(records).toHaveLength(2);
    expect(records[0]?.gateTag).toBe(NOT_IMPLEMENTED_SWEEP_GATE_TAG);
    expect(records[1]?.gateTag).toBe(GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG);
    expect(records[0]?.id).not.toBe(records[1]?.id);
    expect(records[0]?.objectId).toBe(FAKE_RELEASE_CANDIDATE_OBJECT_ID);
    expect(records[0]?.command).toBe("not-implemented-sweep");

    const fromJournal: string[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer") fromJournal.push(entry.payload.id);
    }
    expect(fromJournal.sort()).toEqual([records[0]?.id, records[1]?.id].sort());
  });

  it("honors an explicit objectId override (the real release-candidate object id, in production)", async () => {
    const changeSetId = randomUUID();
    const realObjectId = "0123456789abcdef0123456789abcdef01234567";
    const [record] = await emitLiveConformanceEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [LIVE_CONFORMANCE_GATE_TAG],
      command: "pinned-range-gate",
      exitStatus: 0,
      objectId: realObjectId,
    });
    expect(record?.objectId).toBe(realObjectId);
  });

  it("records a genuine negative run (nonzero exitStatus) rather than fabricating a pass", async () => {
    const changeSetId = randomUUID();
    const [record] = await emitLiveConformanceEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [NOT_IMPLEMENTED_SWEEP_GATE_TAG],
      command: "not-implemented-sweep",
      exitStatus: 1,
      artifactDigests: ["sha256:deadbeef"],
    });
    expect(record?.exitStatus).toBe(1);
    expect(record?.artifactDigests).toEqual(["sha256:deadbeef"]);
  });

  it("defaults artifactDigests to [] and uses an injectable clock", async () => {
    const changeSetId = randomUUID();
    const [record] = await emitLiveConformanceEvidence({
      journal: tj.store,
      changeSetId,
      gateTags: [LIVE_CONFORMANCE_GATE_TAG],
      command: "sandbox-selftest",
      exitStatus: 0,
      capturedAt: () => "2026-01-01T00:00:00.000Z",
    });
    expect(record?.artifactDigests).toEqual([]);
    expect(record?.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

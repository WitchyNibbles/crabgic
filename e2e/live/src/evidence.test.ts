import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitLiveConformanceEvidence,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG,
  LIVE_CONFORMANCE_GATE_TAG,
  NOT_IMPLEMENTED_SWEEP_GATE_TAG,
  resolveReleaseCandidateObjectId,
} from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

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
    // The DEFAULT, not a hard-coded literal: unset `$EO_RELEASE_CANDIDATE_
    // OBJECT_ID` (the ordinary `npm run test:e2e` gate) this is exactly
    // `FAKE_RELEASE_CANDIDATE_OBJECT_ID`; under a real release-gate run it
    // is the release candidate's own object ID. Asserting the resolver's
    // value keeps this test true in both modes without ever letting the
    // emitter silently stop using the default.
    expect(records[0]?.objectId).toBe(resolveReleaseCandidateObjectId());
    expect(records[0]?.command).toBe("not-implemented-sweep");

    // Scoped to THIS test's own freshly-generated changeSetId, never the
    // whole journal: under a shared journal (`EO_RELEASE_GATE_JOURNAL_DIR`,
    // see `./testJournal.ts`) every other harness's evidence is visible
    // here too, and an unfiltered "the journal contains exactly these two
    // records" assertion would either break or start passing vacuously.
    const fromJournal: string[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer", changeSetId })) {
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
      // EXPLICIT fixture objectId, never the resolved default: this record
      // is a SEEDED demo of the emitter's nonzero-exitStatus branch, not a
      // genuine negative run of any release candidate. Under a shared
      // release-gate journal (`EO_RELEASE_GATE_JOURNAL_DIR` +
      // `EO_RELEASE_CANDIDATE_OBJECT_ID`) the default would stamp this
      // synthetic failure with the REAL candidate's object ID, and
      // `e2e/report`'s generator — correctly, and by design — would then
      // FAIL `gateway-cli-surface-complete` and `quality-security-perf-
      // learning-gates` on a lie this unit test invented.
      objectId: "f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed",
    });
    expect(record?.objectId).toBe("f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed");
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

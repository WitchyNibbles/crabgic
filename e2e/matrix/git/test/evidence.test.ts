import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GIT_MATRIX_GATE_TAG,
  buildScenarioEvidence,
  digestArtifact,
  emitScenarioEvidence,
} from "../src/evidence.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("evidence emission", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("digestArtifact is deterministic and content-sensitive", () => {
    const a = digestArtifact("hello");
    const b = digestArtifact("hello");
    const c = digestArtifact("world");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  it("buildScenarioEvidence produces a schema-valid EvidenceRecord tagged release-gate:git-matrix", () => {
    const record = buildScenarioEvidence({
      changeSetId: "8f14e45f-ceea-467e-adde-0000000000aa",
      command: "preflightMerge (clean)",
      exitStatus: 0,
      objectId: "deadbeef",
      detail: "treeId=abc123",
    });
    expect(record.gateTag).toBe(GIT_MATRIX_GATE_TAG);
    expect(record.command).toBe("preflightMerge (clean)");
    expect(record.exitStatus).toBe(0);
    expect(record.objectId).toBe("deadbeef");
    expect(record.artifactDigests).toHaveLength(1);
  });

  it("emitScenarioEvidence appends exactly one evidence_pointer journal entry, queryable back", async () => {
    await emitScenarioEvidence(journal.store, {
      changeSetId: "8f14e45f-ceea-467e-adde-0000000000bb",
      command: "validateRepository (sha256)",
      exitStatus: 0,
      objectId: "cafef00d",
      detail: "objectFormat=sha256",
    });

    const entries = [];
    for await (const entry of journal.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    if (entries[0]?.type === "evidence_pointer") {
      expect(entries[0].payload.gateTag).toBe(GIT_MATRIX_GATE_TAG);
      expect(entries[0].payload.objectId).toBe("cafef00d");
    }
  });

  it("a nonzero exitStatus is recorded verbatim", async () => {
    const record = await emitScenarioEvidence(journal.store, {
      changeSetId: "8f14e45f-ceea-467e-adde-0000000000cc",
      command: "publishLocal (seeded leak)",
      exitStatus: 1,
      objectId: "abc123",
      detail: "leak detected",
    });
    expect(record.exitStatus).toBe(1);
  });
});

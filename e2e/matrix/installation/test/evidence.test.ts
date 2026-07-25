import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INSTALLATION_MATRIX_GATE_TAG,
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

  it("buildScenarioEvidence produces a schema-valid EvidenceRecord tagged release-gate:installation-matrix", () => {
    const record = buildScenarioEvidence({
      changeSetId: "8f14e45f-ceea-467e-adde-0000000000aa",
      command: "install --json (empty-dir)",
      exitStatus: 0,
      objectId: "deadbeef",
      detail: "status=installed",
    });
    expect(record.gateTag).toBe(INSTALLATION_MATRIX_GATE_TAG);
    expect(record.command).toBe("install --json (empty-dir)");
    expect(record.exitStatus).toBe(0);
    expect(record.objectId).toBe("deadbeef");
    expect(record.artifactDigests).toHaveLength(1);
  });

  it("emitScenarioEvidence appends exactly one evidence_pointer journal entry, queryable back", async () => {
    // Freshly generated, NOT the shared fixture literal the sibling git
    // matrix also uses: under a shared journal
    // (`EO_RELEASE_GATE_JOURNAL_DIR`) both harnesses write to one place, and
    // a hardcoded id would make each harness see the other's record.
    const changeSetId = randomUUID();
    await emitScenarioEvidence(journal.store, {
      changeSetId,
      command: "install --json (unborn-head)",
      exitStatus: 0,
      objectId: "cafef00d",
      detail: "status=installed repoState=unborn-head",
    });

    // changeSetId-scoped: under a shared journal
    // (`EO_RELEASE_GATE_JOURNAL_DIR`, see `../src/test-support/
    // test-journal.ts`) every sibling scenario's evidence is visible here
    // too, so "exactly one entry in the journal" would stop meaning "this
    // call appended exactly one entry".
    const entries = [];
    for await (const entry of journal.store.queryEntries({
      type: "evidence_pointer",
      changeSetId,
    })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("evidence_pointer");
    if (entries[0]?.type === "evidence_pointer") {
      expect(entries[0].payload.gateTag).toBe(INSTALLATION_MATRIX_GATE_TAG);
      expect(entries[0].payload.objectId).toBe("cafef00d");
    }
  });

  it("a nonzero exitStatus is recorded verbatim (never silently coerced to 0)", async () => {
    const record = await emitScenarioEvidence(journal.store, {
      changeSetId: "8f14e45f-ceea-467e-adde-0000000000cc",
      command: "uninstall --json (broken double)",
      exitStatus: 1,
      objectId: "abc123",
      detail: "a violation was found",
    });
    expect(record.exitStatus).toBe(1);
  });
});

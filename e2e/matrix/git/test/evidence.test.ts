import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GIT_MATRIX_GATE_TAG,
  buildScenarioEvidence,
  digestArtifact,
  emitScenarioEvidence,
} from "../src/evidence.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

const RC_ENV = "CRABGIC_RELEASE_CANDIDATE_OBJECT_ID";

describe("evidence emission", () => {
  let journal: TestJournal;
  let savedRc: string | undefined;

  beforeEach(async () => {
    journal = await createTestJournal();
    // Every assertion below about a scenario-local `objectId` is only
    // meaningful OUTSIDE a release run. `npm run test:e2e:release-evidence`
    // exports this variable for the whole chain, so these tests must control
    // it explicitly rather than inherit it — otherwise they would assert one
    // thing locally and something else in CI.
    savedRc = process.env[RC_ENV];
    delete process.env[RC_ENV];
  });

  afterEach(async () => {
    if (savedRc === undefined) delete process.env[RC_ENV];
    else process.env[RC_ENV] = savedRc;
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
    // Freshly generated, NOT the shared fixture literal the sibling
    // installation matrix also uses: under a shared journal
    // (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`) both harnesses write to one place, and
    // a hardcoded id would make each harness see the other's record.
    const changeSetId = randomUUID();
    await emitScenarioEvidence(journal.store, {
      changeSetId,
      command: "validateRepository (sha256)",
      exitStatus: 0,
      objectId: "cafef00d",
      detail: "objectFormat=sha256",
    });

    // changeSetId-scoped: under a shared journal
    // (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`, see `../src/test-support/
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
    if (entries[0]?.type === "evidence_pointer") {
      expect(entries[0].payload.gateTag).toBe(GIT_MATRIX_GATE_TAG);
      expect(entries[0].payload.objectId).toBe("cafef00d");
    }
  });

  /**
   * Regression (2026-07-25). This harness is the SOLE evidence source for
   * the `no-engine-attribution` checklist item, and it stamped each
   * scenario's own throwaway-repo object ID. `e2e/report`'s generator links
   * evidence only at the exact `releaseCandidateObjectId`, so every record
   * emitted here was structurally unlinkable and the item sat at
   * EVIDENCE-PENDING while the scenario proving it ran green.
   */
  it("stamps the release candidate under a release run, so the evidence can actually link", () => {
    process.env[RC_ENV] = "5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e";
    const record = buildScenarioEvidence({
      changeSetId: randomUUID(),
      command: "publishLocal (attribution leak)",
      exitStatus: 0,
      objectId: "throwaway-repo-oid",
      detail: "no leak",
    });
    expect(record.objectId).toBe("5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e");
  });

  it("preserves the scenario's own object ID as a digest rather than losing it", () => {
    process.env[RC_ENV] = "5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e";
    const record = buildScenarioEvidence({
      changeSetId: randomUUID(),
      command: "publishLocal (attribution leak)",
      exitStatus: 0,
      objectId: "throwaway-repo-oid",
      detail: "no leak",
    });
    expect(record.artifactDigests).toHaveLength(2);
    expect(record.artifactDigests).toContain(
      digestArtifact("scenario-object-id:throwaway-repo-oid"),
    );
  });

  it("treats an empty release-candidate value as unset", () => {
    process.env[RC_ENV] = "";
    const record = buildScenarioEvidence({
      changeSetId: randomUUID(),
      command: "preflightMerge (clean)",
      exitStatus: 0,
      objectId: "deadbeef",
      detail: "treeId=abc123",
    });
    expect(record.objectId).toBe("deadbeef");
    expect(record.artifactDigests).toHaveLength(1);
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

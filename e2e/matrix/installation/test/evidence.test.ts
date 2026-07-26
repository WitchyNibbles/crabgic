import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INSTALLATION_MATRIX_GATE_TAG,
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

  /**
   * Regression (2026-07-25): this emitter stamped each scenario's own
   * throwaway-repo object ID, which `e2e/report`'s generator can never link
   * to the release candidate. Masked here only because
   * `release-gate:connector-matrix` independently covers the one checklist
   * item this harness feeds — the defect was real either way.
   */
  it("stamps the release candidate under a release run, so the evidence can actually link", () => {
    process.env[RC_ENV] = "5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e";
    const record = buildScenarioEvidence({
      changeSetId: randomUUID(),
      command: "install --json (empty-dir)",
      exitStatus: 0,
      objectId: "throwaway-repo-oid",
      detail: "status=installed",
    });
    expect(record.objectId).toBe("5e2c6b5144743e2b8d846aac5c0454bb5c3ef16e");
    expect(record.artifactDigests).toHaveLength(2);
    expect(record.artifactDigests).toContain(
      digestArtifact("scenario-object-id:throwaway-repo-oid"),
    );
  });

  it("treats an empty release-candidate value as unset", () => {
    process.env[RC_ENV] = "";
    const record = buildScenarioEvidence({
      changeSetId: randomUUID(),
      command: "install --json (empty-dir)",
      exitStatus: 0,
      objectId: "deadbeef",
      detail: "status=installed",
    });
    expect(record.objectId).toBe("deadbeef");
    expect(record.artifactDigests).toHaveLength(1);
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
    // (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`) both harnesses write to one place, and
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

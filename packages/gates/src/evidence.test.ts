import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { emitEvidence, findEvidenceForRequirement } from "./evidence.js";
import type { GateContext, GateVerdict } from "./types.js";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

const verdict: GateVerdict = {
  passed: true,
  command: "npm test",
  exitStatus: 0,
  toolchainFingerprint: "node@24",
  artifactDigests: ["sha256:abc"],
  detail: "ok",
};

describe("emitEvidence", () => {
  it("builds a schema-valid EvidenceRecord and journals it as evidence_pointer", async () => {
    const changeSetId = randomUUID();
    const requirementId = randomUUID();
    const workUnitId = randomUUID();
    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId,
      workUnitId,
      objectId: "objid-1",
      journal: tj.store,
    };

    const record = await emitEvidence(tj.store, context, "tdd", verdict);
    expect(record.changeSetId).toBe(changeSetId);
    expect(record.requirementId).toBe(requirementId);
    expect(record.workUnitId).toBe(workUnitId);
    expect(record.objectId).toBe("objid-1");
    expect(record.gateTag).toBe("tdd");
    expect(record.command).toBe("npm test");

    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("omits requirementId/workUnitId when absent from the context (final_verifying firings carry no single WorkUnit)", async () => {
    const context: GateContext = {
      stage: "final_verifying",
      changeSetId: randomUUID(),
      objectId: "objid-2",
      journal: tj.store,
    };
    const record = await emitEvidence(tj.store, context, "coverage", verdict);
    expect(record.requirementId).toBeUndefined();
    expect(record.workUnitId).toBeUndefined();
  });
});

describe("findEvidenceForRequirement — the reverse half of Requirement -> EvidenceRecord -> exact object ID", () => {
  it("returns every EvidenceRecord journaled for the given requirementId, and none for an unrelated one", async () => {
    const requirementId = randomUUID();
    const otherRequirementId = randomUUID();
    const changeSetId = randomUUID();

    await emitEvidence(
      tj.store,
      { stage: "verifying", changeSetId, requirementId, objectId: "obj-a", journal: tj.store },
      "tdd",
      verdict,
    );
    await emitEvidence(
      tj.store,
      {
        stage: "verifying",
        changeSetId,
        requirementId: otherRequirementId,
        objectId: "obj-b",
        journal: tj.store,
      },
      "tdd",
      verdict,
    );

    const found = await findEvidenceForRequirement(tj.store, requirementId);
    expect(found).toHaveLength(1);
    expect(found[0]?.objectId).toBe("obj-a");

    const foundOther = await findEvidenceForRequirement(tj.store, otherRequirementId);
    expect(foundOther).toHaveLength(1);
    expect(foundOther[0]?.objectId).toBe("obj-b");
  });
});

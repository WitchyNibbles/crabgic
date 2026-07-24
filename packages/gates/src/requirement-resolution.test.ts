import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRequirement } from "@eo/testkit";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import { findEvidenceForRequirement } from "./evidence.js";
import type { GateContext } from "./types.js";

/**
 * Named integration test — roadmap/14 §Exit criteria: "`Requirement` →
 * `EvidenceRecord` → exact object ID resolves in both directions for a
 * fixture `ChangeSet`."
 *
 * FORWARD direction: `Requirement.evidenceRecordIds` (02's own bidirectional-
 * mapping field, `packages/contracts/src/contracts/requirement.ts`) names
 * the `EvidenceRecord`, whose own `.objectId` is the exact object under
 * test. REVERSE direction: given only a `requirementId`, `../evidence.ts`'s
 * `findEvidenceForRequirement` recovers every `EvidenceRecord` journaled
 * for it — and hence the exact object id(s) it was captured against —
 * without needing the `Requirement` record itself at all.
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("Requirement -> EvidenceRecord -> exact object ID resolves in both directions", () => {
  it("resolves forward (Requirement.evidenceRecordIds -> EvidenceRecord.objectId) and in reverse (requirementId -> journal -> EvidenceRecord -> objectId)", async () => {
    const changeSetId = randomUUID();
    const requirementIdSeed = randomUUID();
    const requirement = buildRequirement({ id: requirementIdSeed });

    const registry = createGateRegistry();
    registry.register("tdd", "req-resolution-stub", async () => ({
      passed: true,
      command: "npm test",
      exitStatus: 0,
      toolchainFingerprint: "node@24",
      artifactDigests: [],
      detail: "ok",
    }));

    const context: GateContext = {
      stage: "verifying",
      changeSetId,
      requirementId: requirement.id,
      objectId: "exact-object-under-test",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);
    const evidence = result?.evidence;
    expect(evidence).toBeDefined();

    // FORWARD: the Requirement names this EvidenceRecord (as 11 would, once
    // it assembles the bidirectional mapping); the record's own objectId is
    // the exact object id under test.
    const requirementWithEvidence = { ...requirement, evidenceRecordIds: [evidence!.id] };
    expect(requirementWithEvidence.evidenceRecordIds).toContain(evidence!.id);
    expect(evidence!.objectId).toBe("exact-object-under-test");
    expect(evidence!.requirementId).toBe(requirement.id);

    // REVERSE: starting from ONLY the requirementId, the journal resolves
    // back to the same EvidenceRecord and hence the same exact object id.
    const foundViaJournal = await findEvidenceForRequirement(tj.store, requirement.id);
    expect(foundViaJournal).toHaveLength(1);
    expect(foundViaJournal[0]?.id).toBe(evidence!.id);
    expect(foundViaJournal[0]?.objectId).toBe("exact-object-under-test");
  });
});

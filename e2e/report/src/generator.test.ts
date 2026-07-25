import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@eo/contracts";
import type { ReleaseGateChecklistItemSpec } from "./checklist.js";
import {
  computeOverallVerdict,
  generateReleaseGateReport,
  scoreChecklistItem,
} from "./generator.js";
import type { ReleaseGateChecklistItemResult } from "./schema.js";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";

/**
 * roadmap/23-release-hardening.md §Test plan, "Unit": "`ReleaseGateReport`
 * generator (checklist-item <-> EvidenceRecord linkage; missing-evidence
 * detection returns FAIL, not PASS-by-default)"; work item 1: "failing-
 * test-first: generator FAILs a checklist item with zero linked
 * EvidenceRecords, before any harness feeds it real runs."
 */

function fixtureRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: randomUUID(),
    command: "fixture-command",
    exitStatus: 0,
    toolchainFingerprint: "fixture-toolchain@1",
    capturedAt: new Date().toISOString(),
    artifactDigests: ["sha256:" + "a".repeat(64)],
    objectId: "candidate-obj",
    gateTag: "release-gate:demo-branch-evidence-handoff",
    ...overrides,
  };
}

const ITEM: ReleaseGateChecklistItemSpec = {
  id: "demo-item",
  description: "a synthetic checklist item",
  required: true,
  requiredGateTags: ["release-gate:demo-item"],
};

describe("scoreChecklistItem — fail-first / default-deny on zero linked evidence", () => {
  it("FAILs (never PASS-by-default) when zero evidence matched, in 'final' scoring mode", () => {
    const result = scoreChecklistItem(ITEM, [], "final");
    expect(result.verdict).toBe("FAIL");
    expect(result.linkedEvidence).toEqual([]);
    expect(result.reason).toMatch(/fail-first/i);
  });

  it("reports EVIDENCE-PENDING (never PASS-by-default) when zero evidence matched, in 'interim' scoring mode", () => {
    const result = scoreChecklistItem(ITEM, [], "interim");
    expect(result.verdict).toBe("EVIDENCE-PENDING");
    expect(result.linkedEvidence).toEqual([]);
  });

  it("PASSes when >=1 matched EvidenceRecord and every one is green (exitStatus === 0)", () => {
    const green = fixtureRecord({ gateTag: "release-gate:demo-item" });
    const result = scoreChecklistItem(ITEM, [green], "final");
    expect(result.verdict).toBe("PASS");
    expect(result.linkedEvidence).toHaveLength(1);
    expect(result.linkedEvidence[0]).toEqual({
      evidenceRecordId: green.id,
      objectId: green.objectId,
      artifactDigests: green.artifactDigests,
      gateTag: green.gateTag,
      exitStatus: 0,
    });
  });

  it("FAILs when any matched EvidenceRecord is negative, even alongside other green matches (both modes)", () => {
    const green = fixtureRecord({ gateTag: "release-gate:demo-item", exitStatus: 0 });
    const red = fixtureRecord({ gateTag: "release-gate:demo-item", exitStatus: 1 });
    for (const mode of ["interim", "final"] as const) {
      const result = scoreChecklistItem(ITEM, [green, red], mode);
      expect(result.verdict).toBe("FAIL");
      // Every matched record is still linked, for audit purposes.
      expect(result.linkedEvidence).toHaveLength(2);
    }
  });

  it("never returns PASS when linkedEvidence would be empty — structural invariant", () => {
    for (const mode of ["interim", "final"] as const) {
      const result = scoreChecklistItem(ITEM, [], mode);
      expect(result.verdict).not.toBe("PASS");
    }
  });
});

describe("computeOverallVerdict", () => {
  function item(
    verdict: ReleaseGateChecklistItemResult["verdict"],
  ): ReleaseGateChecklistItemResult {
    return {
      id: randomUUID(),
      description: "d",
      required: true,
      verdict,
      linkedEvidence: [],
      reason: "r",
    };
  }

  it("is PASS only when every item is PASS", () => {
    expect(computeOverallVerdict([item("PASS"), item("PASS")])).toBe("PASS");
  });

  it("is FAIL if any item is FAIL, regardless of the others", () => {
    expect(computeOverallVerdict([item("PASS"), item("FAIL"), item("EVIDENCE-PENDING")])).toBe(
      "FAIL",
    );
  });

  it("is EVIDENCE-PENDING if no item is FAIL but >=1 is EVIDENCE-PENDING", () => {
    expect(computeOverallVerdict([item("PASS"), item("EVIDENCE-PENDING")])).toBe(
      "EVIDENCE-PENDING",
    );
  });
});

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

async function journalEvidence(record: EvidenceRecord): Promise<void> {
  await tj.store.appendEntry({
    type: "evidence_pointer",
    changeSetId: record.changeSetId,
    payload: record,
  });
}

describe("generateReleaseGateReport — end-to-end over a real @eo/journal JournalStore", () => {
  /**
   * A FRESH release-candidate object id per test, not one shared constant.
   * The generator's only scoping mechanism is exact-`objectId` matching, so
   * a shared literal makes every test in this file visible to every other
   * one the moment the underlying journal stops being per-test — which is
   * exactly what `EO_RELEASE_GATE_JOURNAL_DIR` does (see
   * `./test-support/test-journal.ts`). The "zero evidence at all" tests in
   * particular would silently start scoring against a sibling test's
   * records. A per-test id keeps every assertion below meaning what it
   * says in both modes.
   */
  let candidate: string;

  beforeEach(() => {
    candidate = randomUUID();
  });

  const checklist: readonly ReleaseGateChecklistItemSpec[] = [
    {
      id: "item-a",
      description: "item A",
      required: true,
      requiredGateTags: ["release-gate:item-a"],
    },
    {
      id: "item-b",
      description: "item B",
      required: true,
      requiredGateTags: ["release-gate:item-b"],
    },
  ];

  it("FAILs every item closed (final mode) when the journal has zero evidence at all", async () => {
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "final",
      checklist,
    });
    expect(report.items.map((i) => i.verdict)).toEqual(["FAIL", "FAIL"]);
    expect(report.overallVerdict).toBe("FAIL");
  });

  it("reports EVIDENCE-PENDING for every item (interim mode) when the journal has zero evidence at all", async () => {
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "interim",
      checklist,
    });
    expect(report.items.map((i) => i.verdict)).toEqual(["EVIDENCE-PENDING", "EVIDENCE-PENDING"]);
    expect(report.overallVerdict).toBe("EVIDENCE-PENDING");
  });

  it("matches an item to its EvidenceRecord by (gateTag, exact release-candidate objectId) and PASSes only that item", async () => {
    await journalEvidence(
      fixtureRecord({ objectId: candidate, gateTag: "release-gate:item-a", exitStatus: 0 }),
    );
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "final",
      checklist,
    });
    const [a, b] = report.items;
    expect(a?.verdict).toBe("PASS");
    expect(a?.linkedEvidence).toHaveLength(1);
    expect(b?.verdict).toBe("FAIL"); // item-b still has zero evidence
    expect(report.overallVerdict).toBe("FAIL"); // one FAIL taints the whole report
  });

  it("NEVER links or counts evidence captured against a DIFFERENT object ID", async () => {
    await journalEvidence(
      fixtureRecord({
        objectId: "some-other-commit",
        gateTag: "release-gate:item-a",
        exitStatus: 0,
      }),
    );
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "final",
      checklist,
    });
    expect(report.items[0]?.verdict).toBe("FAIL");
    expect(report.items[0]?.linkedEvidence).toEqual([]);
  });

  it("NEVER matches an EvidenceRecord whose gateTag isn't in the item's requiredGateTags, even at the right object ID", async () => {
    await journalEvidence(
      fixtureRecord({ objectId: candidate, gateTag: "unrelated-tag", exitStatus: 0 }),
    );
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "final",
      checklist,
    });
    expect(report.items.every((i) => i.verdict === "FAIL")).toBe(true);
  });

  it("uses the injected clock for generatedAt", async () => {
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "interim",
      checklist,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("defaults to the full 15-item RELEASE_GATE_CHECKLIST when none is supplied", async () => {
    const report = await generateReleaseGateReport({
      journal: tj.store,
      releaseCandidateObjectId: candidate,
      scoringMode: "interim",
    });
    expect(report.items).toHaveLength(15);
  });
});

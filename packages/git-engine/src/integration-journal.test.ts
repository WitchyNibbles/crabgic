import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@eo/contracts";
import {
  buildCasRefUpdateEntryInput,
  buildEvidencePointerEntryInput,
} from "./integration-journal.js";

describe("buildCasRefUpdateEntryInput", () => {
  it("omits correlation fields entirely when none are supplied", () => {
    expect(buildCasRefUpdateEntryInput("refs/heads/x", "a".repeat(40))).toEqual({
      type: "cas_ref_update",
      payload: { ref: "refs/heads/x", objectId: "a".repeat(40) },
    });
  });

  it("includes only the correlation fields actually supplied", () => {
    expect(
      buildCasRefUpdateEntryInput("refs/heads/x", "a".repeat(40), { changeSetId: "cs-1" }),
    ).toEqual({
      type: "cas_ref_update",
      payload: { ref: "refs/heads/x", objectId: "a".repeat(40) },
      changeSetId: "cs-1",
    });
  });

  it("includes every correlation field when all are supplied", () => {
    expect(
      buildCasRefUpdateEntryInput("refs/heads/x", "a".repeat(40), {
        runId: "run-1",
        changeSetId: "cs-1",
        workUnitId: "wu-1",
      }),
    ).toEqual({
      type: "cas_ref_update",
      payload: { ref: "refs/heads/x", objectId: "a".repeat(40) },
      runId: "run-1",
      changeSetId: "cs-1",
      workUnitId: "wu-1",
    });
  });
});

describe("buildEvidencePointerEntryInput", () => {
  it("wraps an EvidenceRecord as the entry payload with the changeSetId at the envelope level", () => {
    const evidenceRecord: EvidenceRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "b0000000-0000-4000-8000-000000000001",
      changeSetId: "b0000000-0000-4000-8000-000000000002",
      command: "renderWithRegeneration:pr_title",
      exitStatus: 0,
      toolchainFingerprint: "@eo/git-engine evidence-attachment",
      capturedAt: new Date().toISOString(),
      artifactDigests: ["deadbeef"],
      objectId: "a".repeat(40),
    };

    expect(
      buildEvidencePointerEntryInput(evidenceRecord, "b0000000-0000-4000-8000-000000000002"),
    ).toEqual({
      type: "evidence_pointer",
      payload: evidenceRecord,
      changeSetId: "b0000000-0000-4000-8000-000000000002",
    });
  });
});

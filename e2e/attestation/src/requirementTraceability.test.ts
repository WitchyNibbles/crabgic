import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord, RemoteResource, Requirement } from "@eo/contracts";
import type { RemoteEvidencePointer } from "@eo/gates";
import {
  checkRequirementTraceability,
  readRequirementTraceabilityInput,
} from "./requirementTraceability.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RC = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/**
 * `buildTraceabilityView` reads exactly `requirement.id`/`workUnitIds`,
 * `evidenceRecord.requirementId`/`objectId`, `remoteResource.id`/`revision`
 * and the pointer fields. These fixtures supply those and are narrowed to
 * the contract types — building fully-populated 02 contracts would add
 * dozens of fields the function under test never reads, and would couple
 * this test to unrelated schema churn.
 */
function requirement(id: string): Requirement {
  return { id, workUnitIds: [`${id}-wu`] } as unknown as Requirement;
}

function evidence(requirementId: string, objectId: string): EvidenceRecord {
  return { requirementId, objectId } as unknown as EvidenceRecord;
}

function remoteResource(id: string, revision: string): RemoteResource {
  return { id, revision } as unknown as RemoteResource;
}

function pointer(overrides: Partial<RemoteEvidencePointer> = {}): RemoteEvidencePointer {
  return {
    requirementId: "REQ-1",
    remoteResourceId: "JIRA-1",
    relation: "tracking-issue",
    objectId: RC,
    confirmedRevision: "rev-9",
    evidenceRecordId: "ev-1",
    ...overrides,
  } as RemoteEvidencePointer;
}

/** `exactOptionalPropertyTypes` forbids spreading an explicit `undefined`, so the key is omitted outright. */
function pointerWithoutRevision(): RemoteEvidencePointer {
  return {
    requirementId: "REQ-1",
    remoteResourceId: "JIRA-1",
    relation: "tracking-issue",
    objectId: RC,
    evidenceRecordId: "ev-1",
  } as RemoteEvidencePointer;
}

function passingInput() {
  return {
    releaseCandidateObjectId: RC,
    requirements: [requirement("REQ-1")],
    evidenceRecords: [evidence("REQ-1", RC)],
    remoteResources: [remoteResource("JIRA-1", "rev-9")],
    pointers: [pointer()],
  };
}

describe("checkRequirementTraceability — PASS", () => {
  it("passes when every requirement links release-candidate evidence and a confirmed remote revision", () => {
    const result = checkRequirementTraceability(passingInput());
    expect(result.verdict).toBe("PASS");
    expect(result.details).toHaveLength(1);
  });

  it("falls back to the RemoteResource revision when the pointer carries none", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      pointers: [pointerWithoutRevision()],
    });
    expect(result.verdict).toBe("PASS");
  });
});

describe("checkRequirementTraceability — seeded defects each FAIL", () => {
  /** The silent-PASS trap: "every requirement is traced" is vacuously true of none. */
  it("FAILs on an empty requirement set rather than passing vacuously", () => {
    const result = checkRequirementTraceability({ ...passingInput(), requirements: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("never treated as");
  });

  it("FAILs when evidence exists but not at the release-candidate object ID", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      evidenceRecords: [evidence("REQ-1", "0000000000000000000000000000000000000000")],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no evidence at the release-candidate object ID");
  });

  it("FAILs when a requirement has no evidence at all", () => {
    const result = checkRequirementTraceability({ ...passingInput(), evidenceRecords: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("linked object IDs: none");
  });

  it("FAILs when a requirement is bound to no remote resource", () => {
    const result = checkRequirementTraceability({ ...passingInput(), pointers: [] });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("bound to no remote");
  });

  it("FAILs when a remote binding carries no confirmed revision from either source", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      remoteResources: [],
      pointers: [pointerWithoutRevision()],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no confirmed revision");
  });

  it("reports each untraced requirement separately", () => {
    const result = checkRequirementTraceability({
      ...passingInput(),
      requirements: [requirement("REQ-1"), requirement("REQ-2")],
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("REQ-2");
  });
});

describe("readRequirementTraceabilityInput — against the real repository", () => {
  it("reads whatever traceability input exists and carries the supplied evidence records", () => {
    const input = readRequirementTraceabilityInput(REPO_ROOT, RC, []);
    expect(input.releaseCandidateObjectId).toBe(RC);
    expect(Array.isArray(input.requirements)).toBe(true);
    expect(input.evidenceRecords).toEqual([]);
  });
});

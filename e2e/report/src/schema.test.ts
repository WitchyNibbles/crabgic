import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ReleaseGateEvidenceLinkSchema,
  ReleaseGateReportSchema,
  ReleaseGateVerdictSchema,
  RELEASE_GATE_SCHEMA_VERSION,
} from "./schema.js";

const validLink = {
  evidenceRecordId: randomUUID(),
  objectId: "a".repeat(40),
  artifactDigests: ["sha256:" + "b".repeat(64)],
  gateTag: "release-gate:demo-branch-evidence-handoff",
  exitStatus: 0,
};

function validReport() {
  return {
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    releaseCandidateObjectId: "a".repeat(40),
    generatedAt: new Date().toISOString(),
    scoringMode: "interim" as const,
    items: [
      {
        id: "demo-branch-evidence-handoff",
        description: "desc",
        required: true,
        verdict: "PASS" as const,
        linkedEvidence: [validLink],
        reason: "1 linked EvidenceRecord(s), all exitStatus === 0.",
      },
    ],
    overallVerdict: "PASS" as const,
  };
}

describe("ReleaseGateVerdictSchema", () => {
  it("accepts exactly the tri-state PASS/FAIL/EVIDENCE-PENDING members", () => {
    for (const v of ["PASS", "FAIL", "EVIDENCE-PENDING"]) {
      expect(ReleaseGateVerdictSchema.parse(v)).toBe(v);
    }
  });

  it("rejects any other string", () => {
    expect(() => ReleaseGateVerdictSchema.parse("pending")).toThrow();
    expect(() => ReleaseGateVerdictSchema.parse("")).toThrow();
  });
});

describe("ReleaseGateEvidenceLinkSchema", () => {
  it("round-trips a valid link", () => {
    expect(ReleaseGateEvidenceLinkSchema.parse(validLink)).toEqual(validLink);
  });

  it("requires at least one artifactDigest (never an evidence link with zero digests)", () => {
    expect(() =>
      ReleaseGateEvidenceLinkSchema.parse({ ...validLink, artifactDigests: [] }),
    ).toThrow();
  });

  it("rejects unknown fields (.strict())", () => {
    expect(() => ReleaseGateEvidenceLinkSchema.parse({ ...validLink, extra: "nope" })).toThrow();
  });
});

describe("ReleaseGateReportSchema", () => {
  it("round-trips a valid report", () => {
    const report = validReport();
    expect(ReleaseGateReportSchema.parse(report)).toEqual(report);
  });

  it("requires at least one item", () => {
    expect(() => ReleaseGateReportSchema.parse({ ...validReport(), items: [] })).toThrow();
  });

  it("rejects a schemaVersion other than the pinned literal", () => {
    expect(() => ReleaseGateReportSchema.parse({ ...validReport(), schemaVersion: 2 })).toThrow();
  });

  it("rejects unknown top-level fields (.strict())", () => {
    expect(() => ReleaseGateReportSchema.parse({ ...validReport(), extra: true })).toThrow();
  });
});

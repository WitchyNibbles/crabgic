import { describe, expect, it } from "vitest";
import { EvidenceRecordSchema } from "./evidence-record.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const REQUIREMENT_ID = "33333333-3333-4333-8333-333333333333";
const WORK_UNIT_ID = "44444444-4444-4444-8444-444444444444";

function validEvidenceRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    changeSetId: CHANGE_SET_ID,
    command: "npm run test:coverage",
    exitStatus: 0,
    toolchainFingerprint: "node-24.1.0+npm-11.0.0",
    capturedAt: "2026-07-15T12:00:00.000Z",
    artifactDigests: ["sha256:abcd1234"],
    objectId: "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d",
    ...overrides,
  };
}

describe("EvidenceRecordSchema", () => {
  it("parses a fully-valid minimal fixture (no requirementId/workUnitId/gateTag)", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord());
    expect(result.success).toBe(true);
  });

  it("parses a fully-valid fixture with every optional field present", () => {
    const result = EvidenceRecordSchema.safeParse(
      validEvidenceRecord({
        requirementId: REQUIREMENT_ID,
        workUnitId: WORK_UNIT_ID,
        gateTag: "tdd",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required command)", () => {
    const fixture = validEvidenceRecord();
    delete fixture.command;
    const result = EvidenceRecordSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a negative exitStatus", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord({ exitStatus: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty artifactDigests entry (must be non-empty strings)", () => {
    const result = EvidenceRecordSchema.safeParse(validEvidenceRecord({ artifactDigests: [""] }));
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = EvidenceRecordSchema.safeParse({
      ...validEvidenceRecord(),
      unexpectedField: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = EvidenceRecordSchema.parse(
      validEvidenceRecord({
        requirementId: REQUIREMENT_ID,
        workUnitId: WORK_UNIT_ID,
        gateTag: "coverage",
      }),
    );
    const revived = EvidenceRecordSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});

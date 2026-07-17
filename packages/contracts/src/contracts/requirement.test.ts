import { describe, expect, it } from "vitest";
import { INTENT_CONTRACT_SECTION_KEYS } from "./intent-contract.js";
import { RequirementSchema } from "./requirement.js";

const validRequirement = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  intentContractId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  section: "performance",
  title: "Doctor run completes quickly",
  description: "The `doctor` command must complete its full check suite in bounded time.",
  acceptanceCriteria: ["p95 wall-clock time under 5s on a warm cache"],
  workUnitIds: ["6c84fb90-12c4-11e1-840d-7b25c5ee775a"],
  renderedArtifactIds: [],
  testIdentifiers: ["packages/cli/src/doctor.test.ts > completes under budget"],
  evidenceRecordIds: [],
  createdAt: "2026-07-15T12:00:00.000Z",
};

describe("RequirementSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/11 §In scope, Contract assembly bullet)", () => {
    expect(RequirementSchema.safeParse(validRequirement).success).toBe(true);
  });

  it("accepts every declared IntentContract section as a `section` value (roadmap/15:20 budget-sourcing tie-in)", () => {
    for (const section of INTENT_CONTRACT_SECTION_KEYS) {
      const fixture = { ...validRequirement, section };
      expect(RequirementSchema.safeParse(fixture).success).toBe(true);
    }
  });
});

describe("RequirementSchema — invalid-shape rejection", () => {
  it("rejects an empty acceptanceCriteria array (min(1))", () => {
    const invalid = { ...validRequirement, acceptanceCriteria: [] };
    expect(RequirementSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a section value outside the closed IntentContract section vocabulary", () => {
    const invalid = { ...validRequirement, section: "not-a-real-section" };
    expect(RequirementSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a non-uuid entry in workUnitIds", () => {
    const invalid = { ...validRequirement, workUnitIds: ["not-a-uuid"] };
    expect(RequirementSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing title", () => {
    const { title: _title, ...rest } = validRequirement;
    expect(RequirementSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RequirementSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    const invalid = { ...validRequirement, unexpected: "field" };
    expect(RequirementSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("RequirementSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = RequirementSchema.parse(validRequirement);
    const roundTripped = RequirementSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});

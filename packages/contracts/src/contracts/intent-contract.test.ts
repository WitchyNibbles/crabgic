import { describe, expect, it } from "vitest";
import { INTENT_CONTRACT_SECTION_KEYS, IntentContractSchema } from "./intent-contract.js";

const validSections = {
  scope: "Add a doctor command that validates the host end-to-end.",
  "non-goals": "Not building a GUI installer.",
  audience: "Repo maintainers running the CLI locally.",
  compatibility: "Requires Node >=24.",
  security: "No new credential storage introduced.",
  performance: "Doctor run completes in under 5s on a warm cache.",
  observability: "Emits a structured check report.",
  rollout: "Ships behind no flag; available immediately on install.",
  acceptance: "Every seeded fault fixture produces a correct finding.",
};

const validContract = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  changeSetId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  createdAt: "2026-07-15T12:00:00.000Z",
  sections: validSections,
  requirementIds: ["6c84fb90-12c4-11e1-840d-7b25c5ee775a"],
};

describe("IntentContractSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/11 §In scope, Contract assembly bullet)", () => {
    expect(IntentContractSchema.safeParse(validContract).success).toBe(true);
  });

  it("accepts an empty requirementIds array (a freshly-drafted contract before IDs are assigned)", () => {
    const draft = { ...validContract, requirementIds: [] };
    expect(IntentContractSchema.safeParse(draft).success).toBe(true);
  });

  it("declares exactly the 9 named sections cited by roadmap/11 and roadmap/14", () => {
    expect(INTENT_CONTRACT_SECTION_KEYS.length).toBe(9);
    expect(INTENT_CONTRACT_SECTION_KEYS).toEqual([
      "scope",
      "non-goals",
      "audience",
      "compatibility",
      "security",
      "performance",
      "observability",
      "rollout",
      "acceptance",
    ]);
  });
});

describe("IntentContractSchema — invalid-shape rejection", () => {
  it("rejects a contract missing the `rollout` section", () => {
    const { rollout: _rollout, ...restSections } = validSections;
    const invalid = { ...validContract, sections: restSections };
    expect(IntentContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an empty-string section (NonEmptyStringSchema)", () => {
    const invalid = { ...validContract, sections: { ...validSections, scope: "" } };
    expect(IntentContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a requirementIds entry that is not a uuid", () => {
    const invalid = { ...validContract, requirementIds: ["not-a-uuid"] };
    expect(IntentContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing changeSetId", () => {
    const { changeSetId: _changeSetId, ...rest } = validContract;
    expect(IntentContractSchema.safeParse(rest).success).toBe(false);
  });
});

describe("IntentContractSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    const invalid = { ...validContract, unexpected: "field" };
    expect(IntentContractSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key inside sections", () => {
    const invalid = { ...validContract, sections: { ...validSections, extra: "field" } };
    expect(IntentContractSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("IntentContractSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = IntentContractSchema.parse(validContract);
    const roundTripped = IntentContractSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});

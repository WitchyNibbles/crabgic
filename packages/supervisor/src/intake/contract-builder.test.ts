import { describe, expect, it } from "vitest";
import { buildIntentContract, type RequirementDraft } from "./contract-builder.js";

const ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

const SECTIONS = {
  scope: "s",
  "non-goals": "n",
  audience: "a",
  compatibility: "c",
  security: "sec",
  performance: "p",
  observability: "o",
  rollout: "r",
  acceptance: "acc",
};

const DRAFTS: RequirementDraft[] = [
  {
    section: "scope",
    title: "Add login form",
    description: "d",
    acceptanceCriteria: ["works"],
  },
];

describe("buildIntentContract", () => {
  it("assembles a schema-valid IntentContract with matching requirementIds", () => {
    const { intentContract, requirements } = buildIntentContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      sections: SECTIONS,
      requirements: DRAFTS,
    });
    expect(requirements).toHaveLength(1);
    expect(intentContract.requirementIds).toEqual([requirements[0]!.id]);
    expect(requirements[0]!.intentContractId).toBe(ID);
  });

  it("assigns the SAME requirement id across two independent builds of the same contract (stability across re-inspection)", () => {
    const first = buildIntentContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      sections: SECTIONS,
      requirements: DRAFTS,
    });
    const second = buildIntentContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      sections: SECTIONS,
      requirements: DRAFTS,
    });
    expect(first.requirements[0]!.id).toBe(second.requirements[0]!.id);
  });

  it("assigns distinct ids to distinct requirements within the same contract (uniqueness)", () => {
    const { requirements } = buildIntentContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      sections: SECTIONS,
      requirements: [
        ...DRAFTS,
        {
          section: "security",
          title: "Rate-limit login",
          description: "d",
          acceptanceCriteria: ["x"],
        },
      ],
    });
    expect(requirements[0]!.id).not.toBe(requirements[1]!.id);
  });

  it("a requirement in a DIFFERENT contract with the identical title/section gets a different id (scoped to intentContractId)", () => {
    const other = buildIntentContract({
      id: "33333333-3333-4333-8333-333333333333",
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      sections: SECTIONS,
      requirements: DRAFTS,
    });
    const mine = buildIntentContract({
      id: ID,
      changeSetId: CHANGE_SET_ID,
      createdAt: CREATED_AT,
      sections: SECTIONS,
      requirements: DRAFTS,
    });
    expect(other.requirements[0]!.id).not.toBe(mine.requirements[0]!.id);
  });
});

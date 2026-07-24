import { describe, expect, it } from "vitest";
import { ChangeSetSchema } from "@eo/contracts";
import { buildLearningProposal } from "@eo/testkit";
import {
  buildChangeSetForPromotion,
  buildInverseChangeSetForRollback,
} from "./build-change-set.js";

const refs = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};

describe("buildChangeSetForPromotion", () => {
  it("produces a schema-valid ChangeSet in draft state referencing the proposal in its rollback strategy", () => {
    const proposal = buildLearningProposal();
    const changeSet = buildChangeSetForPromotion(proposal, refs);
    expect(() => ChangeSetSchema.parse(changeSet)).not.toThrow();
    expect(changeSet.state).toBe("draft");
    expect(changeSet.rollbackStrategy).toContain(proposal.id);
    expect(changeSet.intentContractId).toBe(refs.intentContractId);
  });

  it("is identical in shape to any other ChangeSet — no learning-specific field exists", () => {
    const proposal = buildLearningProposal();
    const changeSet = buildChangeSetForPromotion(proposal, refs);
    expect(Object.keys(changeSet).sort()).toEqual(
      Object.keys(ChangeSetSchema.parse(changeSet)).sort(),
    );
  });
});

describe("buildInverseChangeSetForRollback", () => {
  it("references the promoted ChangeSet id in its rollback strategy", () => {
    const proposal = buildLearningProposal({ state: "promoted" });
    const inverse = buildInverseChangeSetForRollback(proposal, "promoted-cs-id", refs);
    expect(inverse.rollbackStrategy).toContain("promoted-cs-id");
    expect(inverse.rollbackStrategy).toContain(proposal.id);
  });
});

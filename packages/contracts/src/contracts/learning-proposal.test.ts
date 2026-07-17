import { describe, expect, it } from "vitest";
import { LearningProposalSchema } from "./learning-proposal.js";
import { LEARNING_PROPOSAL_STATES } from "../learning/learning-proposal-state.js";

const ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "22222222-2222-4222-8222-222222222222";
const WORK_UNIT_ID = "33333333-3333-4333-8333-333333333333";
const ROLLBACK_CHANGE_SET_ID = "44444444-4444-4444-8444-444444444444";

function validLearningProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: ID,
    state: "observation",
    content: "Prefer content-hash cache keys salted by toolchain fingerprint to avoid stale hits.",
    evidenceRecordIds: [EVIDENCE_ID],
    createdAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("LearningProposalSchema", () => {
  it("parses a fully-valid minimal fixture (no sourceWorkUnitId/rollbackChangeSetId)", () => {
    const result = LearningProposalSchema.safeParse(validLearningProposal());
    expect(result.success).toBe(true);
  });

  it("parses a fully-valid fixture with every optional field present", () => {
    const result = LearningProposalSchema.safeParse(
      validLearningProposal({
        sourceWorkUnitId: WORK_UNIT_ID,
        rollbackChangeSetId: ROLLBACK_CHANGE_SET_ID,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid-shape fixture (missing required content)", () => {
    const fixture = validLearningProposal();
    delete fixture.content;
    const result = LearningProposalSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    const result = LearningProposalSchema.safeParse({
      ...validLearningProposal(),
      unexpectedField: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a state outside the closed LearningProposalState union", () => {
    const result = LearningProposalSchema.safeParse(validLearningProposal({ state: "archived" }));
    expect(result.success).toBe(false);
  });

  // learning-proposal-state.ts has 0% coverage on its own (roadmap/02 instructions) — this
  // suite is the sole place the 11-member union's membership is asserted end-to-end.
  it("has exactly 11 members", () => {
    expect(LEARNING_PROPOSAL_STATES.length).toBe(11);
  });

  it("accepts every LearningProposalState member (11, reused union) as LearningProposal.state", () => {
    for (const state of LEARNING_PROPOSAL_STATES) {
      const result = LearningProposalSchema.safeParse(validLearningProposal({ state }));
      expect(result.success).toBe(true);
    }
  });

  it("specifically accepts promoted/rejected/rolled_back/expired (post-review terminal-ish members)", () => {
    for (const state of ["promoted", "rejected", "rolled_back", "expired"] as const) {
      const result = LearningProposalSchema.safeParse(validLearningProposal({ state }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects an out-of-union string state", () => {
    const result = LearningProposalSchema.safeParse(
      validLearningProposal({ state: "not_a_real_state" }),
    );
    expect(result.success).toBe(false);
  });

  it("round-trips through JSON.stringify/JSON.parse deep-equal", () => {
    const original = LearningProposalSchema.parse(
      validLearningProposal({
        state: "promoted",
        sourceWorkUnitId: WORK_UNIT_ID,
        rollbackChangeSetId: ROLLBACK_CHANGE_SET_ID,
      }),
    );
    const revived = LearningProposalSchema.parse(JSON.parse(JSON.stringify(original)) as unknown);
    expect(revived).toEqual(original);
  });
});

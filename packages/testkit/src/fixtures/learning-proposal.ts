import {
  CURRENT_SCHEMA_VERSION,
  LearningProposalSchema,
  type LearningProposal,
} from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `LearningProposal` fixture builder — roadmap/02 work item 10. */
export function buildLearningProposal(overrides: Partial<LearningProposal> = {}): LearningProposal {
  const ctx = createFixtureContext();
  const defaults: LearningProposal = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    state: "observation",
    content: "Deterministic fixture lesson content.",
    evidenceRecordIds: [],
    createdAt: ctx.clock.next(),
  };
  return LearningProposalSchema.parse({ ...defaults, ...overrides });
}

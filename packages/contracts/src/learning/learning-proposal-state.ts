import { z } from "zod";

/**
 * `LearningProposalState` (roadmap/02 work item — new, 11-member closed
 * union; the type of `LearningProposal.state`). Transition-table tests,
 * guards, and promotion enforcement are owned by phase 22, which hosts the
 * pipeline this union names — this phase owns only the union + fixtures.
 */
export const LEARNING_PROPOSAL_STATES = [
  "observation",
  "reproducer",
  "candidate",
  "dev_eval",
  "held_out_eval",
  "shadow_run",
  "independent_review",
  "promoted",
  "rejected",
  "rolled_back",
  "expired",
] as const;

export const LearningProposalStateSchema = z.enum(LEARNING_PROPOSAL_STATES);
export type LearningProposalState = z.infer<typeof LearningProposalStateSchema>;

/**
 * `@eo/learning` public barrel — roadmap/22-learning-system.md. Every
 * cross-cutting type/function this package exposes to `packages/cli`'s
 * `learn list|approve|reject|rollback` backend (the ONLY consumer —
 * roadmap/22 §In scope: "promotion/review is CLI-only") is exported from
 * exactly this one module.
 *
 * Excluded deliberately (test-support-only, not part of this package's
 * public API surface, mirroring every sibling package's identical
 * convention — `@eo/scheduler`, `@eo/gates`, `@eo/supervisor`):
 * `test-support/minimal-compiled-profile.ts`.
 */

// ---- State machine (work item 1) ----
export {
  IllegalTransitionError,
  isLearningProposalAbsorbing,
  LEARNING_PROPOSAL_ABSORBING_STATES,
  LEARNING_PROPOSAL_TRANSITIONS,
  learningProposalTransition,
} from "./state-machine.js";

// ---- Typed errors ----
export {
  ContaminationDetectedError,
  DuplicateApprovalTokenError,
  InsufficientIndependentReviewError,
  NotPromotedError,
  ProposalNotFoundError,
} from "./errors.js";

// ---- On-disk layout (work item 1) ----
export {
  LEARNING_DIR_MODE,
  LEARNING_GRADER_DEV_SUBDIR,
  LEARNING_GRADER_HELD_OUT_SUBDIR,
  LEARNING_GRADER_SUBDIR,
  LEARNING_REGISTRY_SUBDIR,
  LEARNING_SEALED_DIR_MODE,
  LEARNING_SEALED_FILE_MODE,
  LEARNING_STATE_SUBDIR,
  resolveDevCasesDir,
  resolveGraderDir,
  resolveHeldOutCasesDir,
  resolveLearningDir,
  resolveRegistryDir,
} from "./store/layout.js";

// ---- Proposal store (work item 1) ----
export { ProposalRegistry } from "./proposal-store/registry.js";
export type {
  CreateProposalInput,
  LearningReviewTokenVerifier,
  TransitionOptions,
  VerifiedApprovalRecord,
} from "./proposal-store/registry.js";

// ---- Grader-only case fixture store (work items 1, 3) ----
export { CaseFixtureStore } from "./store/case-fixture-store.js";

// ---- Reproducer harness (work item 2) ----
export { buildReproducerFixture, replayReproducer } from "./reproducer/reproducer-harness.js";
export type {
  ReplayReproducerOptions,
  ReproducerFixture,
} from "./reproducer/reproducer-harness.js";

// ---- Eval infra: case schema, contamination, grading (work item 3) ----
export {
  computeCaseHash,
  decodeCasesJsonl,
  encodeCasesJsonl,
  EvalCaseSchema,
} from "./eval/case-schema.js";
export type { EvalCase } from "./eval/case-schema.js";
export { assertNoContamination, detectContamination } from "./eval/contamination.js";
export type { ContaminationReport } from "./eval/contamination.js";
export { gradeCase, runEvalSuite } from "./eval/eval-runner.js";
export type { CaseResult, EvalSuiteResult } from "./eval/eval-runner.js";

// ---- Shadow-run comparator (work item 4) ----
export { compareShadowOutcome, runShadowComparison } from "./shadow/shadow-comparator.js";
export type {
  BaselineOutcome,
  ShadowComparison,
  ShadowComparisonVerdict,
} from "./shadow/shadow-comparator.js";

// ---- ChangeSet construction (work items 5, 6) ----
export {
  buildChangeSetForPromotion,
  buildInverseChangeSetForRollback,
} from "./changeset/build-change-set.js";
export type { ChangeSetReferences } from "./changeset/build-change-set.js";

// ---- Promotion (work item 5) ----
export { promoteProposal } from "./promotion/promote.js";
export type { PromoteProposalOptions, PromoteProposalResult } from "./promotion/promote.js";

// ---- Rollback (work item 6) ----
export { rollbackProposal } from "./rollback/rollback.js";
export type { RollbackProposalOptions, RollbackProposalResult } from "./rollback/rollback.js";

// ---- Expiry sweeper (work item 6) ----
export { sweepExpiredProposals } from "./expiry/expiry-sweeper.js";
export type { ExpirySweepResult } from "./expiry/expiry-sweeper.js";

// ---- Promptfoo export (work item 6; package-internal, no new CLI verb) ----
export { exportToPromptfooConfig } from "./promptfoo/export.js";
export type { PromptfooAssertion, PromptfooConfig, PromptfooTestCase } from "./promptfoo/export.js";

/**
 * `@eo/perf` public barrel — roadmap/15-performance-contracts.md. Every
 * cross-cutting type/function this package exposes (its registered
 * performance gate handler, the risk detector, the twin-worktree runner,
 * the stats/decision engine, the measurement wrappers, and the two
 * adapters) is exported from exactly this one module, matching every
 * sibling package's own barrel convention (`@eo/gates`, `@eo/scheduler`).
 *
 * Excluded deliberately (test-support-only, not part of this package's
 * public API): `test-support/test-journal.ts`, `test-support/minimal-
 * compiled-profile.ts` — mirroring `@eo/gates`' own identical exclusion.
 */

// ---- Typed errors (fail-closed everywhere) ----
export {
  BudgetHashLinkMismatchError,
  BudgetJournalAnchorMissingError,
  InsufficientSamplesError,
  MethodologyViolationError,
  MissingMeasurementError,
  NoBenchmarkCommandError,
  ProcessSampleUnavailableError,
} from "./errors.js";
export type { MethodologyViolationReason } from "./errors.js";

// ---- Risk detector (work item 1) ----
export { PERFORMANCE_RISK_CATEGORIES, DIFF_PATH_RISK_PATTERNS } from "./risk/categories.js";
export type { PerformanceRiskCategory } from "./risk/categories.js";
export {
  classifyDiffPath,
  classifyDiffPaths,
  unionDiffPathRiskCategories,
} from "./risk/diff-analyzer.js";
export type { DiffPathRiskMatch } from "./risk/diff-analyzer.js";
export {
  STACK_EVIDENCE_CATEGORY_TO_RISK,
  STACK_EVIDENCE_RISK_CONFIDENCE_FLOOR,
  stackEvidenceRiskCategories,
} from "./risk/stack-evidence-risk.js";
export { detectPerformanceRisk } from "./risk/detector.js";
export type { DetectPerformanceRiskOptions } from "./risk/detector.js";

// ---- PerformanceContract builder: canonical hash, budget sourcing, hash-link, contract builder (work item 1) ----
export { canonicalHash, canonicalStringify } from "./contract/canonical-hash.js";
export type { CanonicalJsonValue } from "./contract/canonical-hash.js";
export {
  parseAcceptanceCriteriaAsBudgets,
  parseAcceptanceCriterionAsBudget,
} from "./contract/acceptance-criteria-parser.js";
export {
  ECOSYSTEM_RESEARCH_BUDGETS,
  ecosystemResearchBudgets,
} from "./contract/ecosystem-research-table.js";
export { resolveBudgetSource } from "./contract/budget-sourcing.js";
export type {
  ResolveBudgetSourceOptions,
  ResolvedBudgetSource,
} from "./contract/budget-sourcing.js";
export { verifyProvisionalBudgetIntegrity } from "./contract/hash-link.js";
export type {
  BudgetIntegrityCheckResult,
  BudgetIntegrityFailureReason,
} from "./contract/hash-link.js";
export { findJournalAnchoredBudgetSnapshot } from "./contract/journal-anchor.js";
export type { JournalAnchoredBudgetSnapshot } from "./contract/journal-anchor.js";
export { buildEnforcedPerformanceContract } from "./contract/contract-builder.js";
export type {
  BuildEnforcedPerformanceContractOptions,
  MeasuredBudgetValue,
} from "./contract/contract-builder.js";

// ---- Measurement wrappers + artifact schema (work item 2) ----
export { ResourceCaptureArtifactSchema } from "./measurement/schema.js";
export type { ResourceCaptureArtifact } from "./measurement/schema.js";
export {
  CLOCK_TICKS_PER_SECOND,
  parseProcIo,
  parseProcStat,
  parseProcStatus,
  ticksToMs,
} from "./measurement/proc-parser.js";
export type { ProcIoFields, ProcStatFields, ProcStatusFields } from "./measurement/proc-parser.js";
export { sampleProcess, trySampleProcess } from "./measurement/process-sampler.js";
export type { ProcessSample } from "./measurement/process-sampler.js";
export { captureSelfRusage } from "./measurement/rusage.js";
export type { SelfRusageSample } from "./measurement/rusage.js";
export { runCommandWithResourceCapture } from "./measurement/command-runner.js";
export type { RunCommandWithResourceCaptureOptions } from "./measurement/command-runner.js";

// ---- Adapters: generic command + Node harness (work item 3) ----
export type { BenchmarkAdapter, BenchmarkAdapterRunParams } from "./adapters/types.js";
export {
  createGenericCommandAdapter,
  resolveDeclaredBenchmarkCommand,
} from "./adapters/generic-command-adapter.js";
export type { CreateGenericCommandAdapterOptions } from "./adapters/generic-command-adapter.js";
export { createNodeHarnessAdapter } from "./adapters/node-harness-adapter.js";
export type { CreateNodeHarnessAdapterOptions } from "./adapters/node-harness-adapter.js";

// ---- Twin-worktree A/B runner + methodology validation (work item 4) ----
export { assertMethodologySound, MIN_INTERLEAVED_REPETITIONS } from "./runner/methodology.js";
export type { ScheduleStep, ScheduleStepKind, ScheduleStepPhase } from "./runner/methodology.js";
export { runTwinWorktreeBenchmark } from "./runner/twin-worktree-runner.js";
export type {
  DispatchedWorktree,
  DispatchWorktreeParams,
  MeasureParams,
  ResourceSample,
  RunTwinWorktreeBenchmarkOptions,
  RunTwinWorktreeBenchmarkResult,
} from "./runner/twin-worktree-runner.js";

// ---- Stats module: bootstrap-CI noise bound + decision engine (work item 5) ----
export { computeNoiseBoundPct, computeRegressionPct } from "./stats/bootstrap-ci.js";
export type { BootstrapNoiseBoundOptions } from "./stats/bootstrap-ci.js";
export { mean } from "./stats/mean.js";
export { higherIsWorse } from "./stats/metric-direction.js";
export {
  CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT,
  CRITICAL_PATH_REGRESSION_THRESHOLD_PCT,
  decide,
  SENSITIVE_PATH_REGRESSION_THRESHOLD_PCT,
} from "./stats/decision-engine.js";
export type { DecideOptions, DecisionResult, PathSensitivity } from "./stats/decision-engine.js";

// ---- Gate registration into 14's registry at final_verifying (work item 6) ----
export { createPerformanceGateHandler } from "./gate/performance-gate.js";
export type {
  CreatePerformanceGateHandlerOptions,
  PerformanceGateEntryInput,
  PerformanceGateMeasurements,
} from "./gate/performance-gate.js";

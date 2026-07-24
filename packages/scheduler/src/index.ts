/**
 * `@eo/scheduler` public barrel — roadmap/13-scheduler-packets-context.md.
 * Every cross-cutting type/function this package exposes to phase 14
 * (quality/security gates, built on this phase's dispatch/candidate seam),
 * 15 (PerformanceContract, this phase's artifact-store benchmark slot),
 * and 22 (learning, this phase's shadow-run mechanism) is exported from
 * exactly this one module — downstream packages import from
 * `@eo/scheduler` directly, never a submodule path.
 *
 * Excluded deliberately (test-support-only, not part of this package's
 * public API surface): `test-support/minimal-compiled-profile.ts` — a
 * fixture builder scoped to this package's own tests, mirroring
 * `packages/supervisor/src/worker-lifecycle/test-support/minimal-compiled-
 * profile.ts`'s own doc comment. `goldens/generate-golden-packets.ts` IS
 * re-exported below, matching `packages/engine-core`'s own barrel
 * convention (its `goldens/generate-golden-artifacts.ts` is public too).
 */

// ---- Errors (typed refusals every module below can throw) ----
export {
  PacketBudgetExceededError,
  PacketEnvelopeViolationError,
  RepairEvidenceRequiredError,
} from "./errors.js";
export type { PacketBudgetViolation, RepairRefusalReason } from "./errors.js";

// ---- TaskPacket budget enforcement (work item 2) ----
export {
  assertPacketWithinBudget,
  checkPacketBudgets,
  DEFAULT_PACKET_FIELD_BUDGETS,
  renderBudgetedField,
} from "./budgets.js";
export type { PacketFieldBudgets } from "./budgets.js";

// ---- TaskPacket builder + ephemeral lesson-preamble slot (work item 2) ----
export { buildTaskPacket } from "./task-packet-builder.js";
export type { BuildTaskPacketOptions, BuildTaskPacketResult } from "./task-packet-builder.js";

// ---- Readiness engine (work item 1) ----
export { buildOverlapAdjacency, computeReadyUnits } from "./readiness.js";
export type { ComputeReadyUnitsOptions, WorkUnitStatusById } from "./readiness.js";

// ---- Fan-out selection + rationale journaling (work item 1) ----
export {
  DEFAULT_CONCURRENCY_CAP,
  journalFanoutRationaleIfFannedOut,
  selectDispatchSet,
} from "./fanout.js";
export type { JournalFanoutRationaleOptions } from "./fanout.js";

// ---- Worker-result validation (engine-agnostic; work item 1) ----
export { validateWorkerResult } from "./worker-result-validation.js";
export type {
  SchedulerSchemaViolationReason,
  SchedulerWorkerResultValidation,
} from "./worker-result-validation.js";

// ---- Attempt-repair policy (work item 1) ----
export {
  assertRepairAllowed,
  countPriorDispatches,
  MAX_TOTAL_DISPATCHES,
  needsRepairPolicyCheck,
} from "./attempt-policy.js";
export type { AttemptEvidenceKind } from "./attempt-policy.js";

// ---- Content-hash + toolchain-fingerprint cache (work item 4) ----
export { cacheKeyString, getOrCompute, SchedulerCache } from "./cache.js";
export type { CacheEntry, CacheKey, GetOrComputeOptions, GetOrComputeResult } from "./cache.js";

// ---- Artifact store + summary projection (work item 3) ----
export { ArtifactStore, ArtifactTooLargeError, MAX_ARTIFACT_BYTES } from "./artifact-store.js";
export type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactSummary,
  PutArtifactOptions,
} from "./artifact-store.js";

// ---- Model router + config schema (work item 5) ----
export {
  DEFAULT_MODEL_ALIAS,
  DEFAULT_ROUTER_CONFIG,
  MODEL_ALIASES,
  resolveModelForRole,
  RouterConfigSchema,
} from "./router.js";
export type { ModelAlias, RouterConfig } from "./router.js";

// ---- Limit-parking state machine (work item 5) ----
export {
  getLatestParkTimer,
  getParkStatus,
  GLOBAL_PAUSE_SUBJECT_ID,
  isGloballyPaused,
  isPastReset,
  parkWorkUnit,
  RATE_LIMIT_PARK_TIMER_DECISION,
} from "./parking.js";
export type { ParkStatus, ParkTimerPayload, ParkWorkUnitOptions } from "./parking.js";

// ---- Shadow-run mechanism (work item 6) ----
export { runShadowAttempt, SHADOW_RUN_MARKER_DECISION } from "./shadow-run.js";
export type { RunShadowAttemptOptions, ShadowRunResult } from "./shadow-run.js";

// ---- Executor: dispatch/resume + evidence seam (work item 1) ----
export { dispatchAttempt, resumeAttempt } from "./executor.js";
export type {
  DispatchAttemptOptions,
  DispatchAttemptOutcome,
  ResumeAttemptOptions,
} from "./executor.js";

// ---- Golden TaskPackets (work item 2) ----
export { buildGoldenTaskPackets } from "./goldens/generate-golden-packets.js";
export type { GoldenArtifact } from "./goldens/generate-golden-packets.js";

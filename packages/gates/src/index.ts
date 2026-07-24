/**
 * `@eo/gates` public barrel — roadmap/14-quality-security-gates.md. Every
 * cross-cutting type/function this package exposes to downstream phases
 * (15's `performance` gate registration, 21's connector-security fixture
 * registration, 22's grading-ground-truth consumption, 23's release-gate
 * re-invocation) is exported from exactly this one module.
 *
 * Excluded deliberately (test-support-only, not part of this package's
 * public API): `test-support/test-journal.ts`, `test-support/minimal-
 * compiled-profile.ts` — mirroring every sibling package's identical
 * convention (`@eo/scheduler`, `@eo/supervisor`).
 */

// ---- Risk-tag vocabulary (work item 1) ----
export { DEFAULT_GATE_RISK_TAGS, GATE_RISK_TAGS, isGateRiskTag } from "./risk-tags.js";
export type { GateRiskTag } from "./risk-tags.js";

// ---- Core gate types (work item 1) ----
export type { GateContext, GateHandler, GateVerdict, RegisteredGate } from "./types.js";

// ---- EvidenceRecord emission + requirement resolution (work item 1) ----
export { emitEvidence, findEvidenceForRequirement } from "./evidence.js";

// ---- Gate registry (work item 1) ----
export { createGateRegistry } from "./registry.js";
export type { FireOptions, GateFireResult, GateRegistry } from "./registry.js";

// ---- Typed errors (fail-closed everywhere) ----
export {
  MissingCapabilityEntryError,
  NoGatesRegisteredError,
  RedBaselineNotFailingError,
  ToolDigestMismatchError,
} from "./errors.js";

// ---- TDD-evidence gate (work item 2) ----
export { captureRedBaseline, createTddGate, hasRedBaseline } from "./tdd-gate.js";
export type { TddGateInput } from "./tdd-gate.js";

// ---- Coverage adapters + ratchet store + gate (work item 3) ----
export { parseLcovReport } from "./coverage/lcov-adapter.js";
export { parseIstanbulSummary } from "./coverage/istanbul-adapter.js";
export { parseGoCoverProfile } from "./coverage/go-cover-adapter.js";
export { parsePytestCovReport } from "./coverage/pytest-cov-adapter.js";
export { ecosystemsPresent, selectCoverageAdapter } from "./coverage/adapter-selection.js";
export type { CoverageAdapterKind } from "./coverage/adapter-selection.js";
export type { CoverageSummary } from "./coverage/types.js";
export { getCoverageRatchetFloor, recordCoverageObservation } from "./coverage/ratchet-store.js";
export type { RatchetFloor, RatchetRecordResult } from "./coverage/ratchet-store.js";
export { createCoverageGate, GREENFIELD_COVERAGE_MINIMUM_PCT } from "./coverage-gate.js";
export type { CoverageGateInput } from "./coverage-gate.js";

// ---- Security adapters + root-cause detector + gate (work item 4) ----
export { hasBlockingFinding } from "./security/types.js";
export type { ScanFinding, ScanSeverity } from "./security/types.js";
export { parseSemgrepReport } from "./security/semgrep-adapter.js";
export type { SemgrepReport } from "./security/semgrep-adapter.js";
export { parseGitleaksReport } from "./security/gitleaks-adapter.js";
export type { GitleaksReport } from "./security/gitleaks-adapter.js";
export { parseOsvScannerReport } from "./security/osv-scanner-adapter.js";
export type { OsvScannerReport } from "./security/osv-scanner-adapter.js";
export { detectRootCausePolicyViolations } from "./security/root-cause-detector.js";
export type { RootCauseDetectorOptions } from "./security/root-cause-detector.js";
export { resolveDigestPinnedTool } from "./security/tool-resolution.js";
export { selectApplicableSecurityCategories } from "./security/category-selection.js";
export type { ApplicableSecurityCategories } from "./security/category-selection.js";
export {
  createGitleaksGate,
  createOsvScannerGate,
  createRootCausePolicyGate,
  createSemgrepGate,
} from "./security-gate.js";
export type {
  GitleaksGateInput,
  OsvScannerGateInput,
  RootCausePolicyGateInput,
  SemgrepGateInput,
} from "./security-gate.js";

// ---- Flake detector + quarantine registry + gate (work item 5) ----
export { getActiveQuarantine, quarantineTest } from "./flake/quarantine-registry.js";
export type { QuarantineEntry } from "./flake/quarantine-registry.js";
export { createFlakeGate } from "./flake-gate.js";
export type { FlakeGateInput, RerunOutcome } from "./flake-gate.js";

// ---- Final-candidate orchestration (work item 6) ----
export { allGatesPassed, fireFinalCandidateVerification } from "./final-candidate.js";

// ---- engine-conformance binding gate (work item 7) ----
export {
  createEngineConformanceGate,
  ENGINE_LIVE_COMMAND,
  findGreenEngineLiveRecord,
} from "./engine-conformance-gate.js";
export type { EngineConformanceGateInput, EngineLiveRecord } from "./engine-conformance-gate.js";

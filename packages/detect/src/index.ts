/**
 * `@eo/detect` public barrel — roadmap/12-stack-detection-quarantine.md.
 * Stack detection & capability quarantine: pure per-ecosystem detectors
 * producing `StackEvidence` (02), plus the quarantine pipeline every
 * executable capability passes through before becoming a digest-pinned
 * `CapabilityManifest` entry.
 */

// ---- Detection framework (work item 1) ----
export * from "./fs/safe-walk.js";
export * from "./fs/safe-read.js";
export * from "./detectors/index.js";
export * from "./contradiction.js";
export * from "./evidence-builder.js";

// ---- Quarantine pipeline (work items 3-4) ----
export * from "./quarantine/types.js";
export * from "./quarantine/digest.js";
export * from "./quarantine/manifest-entry.js";
export * from "./quarantine/pipeline.js";
export * from "./quarantine/scanners/types.js";
export * from "./quarantine/scanners/secret-scanner.js";
export * from "./quarantine/scanners/script-scanner.js";
export * from "./quarantine/scanners/permission-scanner.js";
export * from "./quarantine/sandbox/types.js";
export * from "./quarantine/sandbox/fake-sandbox-runner.js";
export * from "./quarantine/stages/fetch.js";
export * from "./quarantine/stages/pin.js";
export * from "./quarantine/stages/verify-provenance.js";
export * from "./quarantine/stages/scan-stage.js";
export * from "./quarantine/stages/sandbox-stage.js";

// ---- Content-addressed capability store (work item 3) ----
export * from "./capability-store/layout.js";
export * from "./capability-store/key.js";
export * from "./capability-store/store.js";
export * from "./capability-store/reaudit.js";
export * from "./capability-store/approval-ledger.js";

// ---- capability.audit/capability.approve MCP tools + trust CLI backend (work item 5) ----
export * from "./mcp/tool-definitions.js";
export * from "./mcp/capability-audit-handler.js";
export * from "./mcp/capability-approve-handler.js";
export * from "./trust/dependencies.js";
export * from "./trust/trust-review.js";
export * from "./trust/trust-approve.js";
export * from "./trust/trust-revoke.js";

// ---- Doc-research task-packet generator (work item 2) ----
export * from "./doc-research/packet.js";
export * from "./doc-research/generator.js";

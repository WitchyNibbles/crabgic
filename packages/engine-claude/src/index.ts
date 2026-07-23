/**
 * `@eo/engine-claude` public barrel — roadmap/06-claude-engine-adapter.md.
 *
 * The first real implementation of 03's `EngineAdapter` over
 * `@anthropic-ai/claude-agent-sdk` (exact-pinned per 01's engine-pin-lint
 * policy; engine facts cite `docs/engine-baseline.md`, never memory).
 * Downstream phases (10/11/13/23) import from `@eo/engine-claude` directly,
 * never a submodule path.
 *
 * The re-exports below ARE this package's real `EngineAdapter` implementation
 * surface: adapter config, gateway/model-routing/auth, the version gate,
 * options assembly, event normalization, limit-signal mapping, adjudication
 * policy, hooks, and result validation, plus the `ClaudeEngineAdapter` class
 * itself (with its typed errors) and session helpers.
 */
export * from "./adapter-config.js";

export * from "./gateway-server-config.js";
export * from "./model-routing.js";
export * from "./auth.js";
export * from "./version-gate.js";
export * from "./options-assembler.js";
export * from "./event-normalizer.js";
export * from "./limit-signal.js";
export * from "./adjudication-policy.js";
export * from "./hooks.js";
export * from "./result-validation.js";
export {
  ClaudeEngineAdapter,
  EngineVersionResolutionError,
  TaskPacketValidationError,
  AdjudicationAuditViolationError,
} from "./adapter.js";
export { createSessionRef, transcriptPathForSession, InvalidSessionIdError } from "./session.js";
export type { CreateSessionRefInput } from "./session.js";
// W5 (`@live` conformance suite) exposes NO public surface: the live harness is
// imported only by the co-located `src/live/*.live.test.ts` files (excluded
// from the default gate), and downstream consumers (10/14/23) reuse the
// `engine-live` CI job + its `live-run-record.json` artifact, not TS helpers.

/**
 * `@eo/engine-core` public barrel (roadmap/03-envelope-compiler-engine-
 * adapter.md work item 5 / deliverable 5). Every cross-cutting type/
 * function this package exposes to phase 06 (the real SDK-backed
 * `EngineAdapter`) and this phase's own tests is exported from exactly
 * this one module — downstream packages import from `@eo/engine-core`
 * directly, never a submodule path.
 *
 * Excluded deliberately: `compiler/envelope-fixture.ts`,
 * `adapter/stub-engine-adapter.ts`, and `footguns/envelope-arbitrary.ts` —
 * test-support-only modules (their own doc comments say so), not part of
 * this package's public API surface.
 */

// EngineAdapter contract: types + interface (work item 1).
export * from "./adapter/engine-event.js";
export * from "./adapter/engine-capabilities.js";
export * from "./adapter/session-ref.js";
export * from "./adapter/adjudication.js";
export * from "./adapter/worker-handle.js";
export * from "./adapter/engine-adapter.js";

// Envelope compiler: compiled-profile shapes + emitters (work items 2/3).
// NOTE: `worktree-placeholders.js`'s two constants are exported via
// `sandbox-profile.js`'s own re-export (its historical export site,
// preserved for existing consumers) — NOT also listed here directly, to
// avoid a duplicate-export barrel conflict.
export * from "./compiler/compiled-worker-profile.js";
export * from "./compiler/xdg-default-paths.js";
export * from "./compiler/compiler-error.js";
export * from "./compiler/owned-path.js";
export * from "./compiler/network-destination.js";
export * from "./compiler/permission-profile.js";
export * from "./compiler/sandbox-profile.js";
export * from "./compiler/worker-settings.js";
export * from "./compiler/compile-envelope.js";

// Golden settings artifacts: canonical envelopes + deterministic generator (work item 3).
export * from "./goldens/canonical-envelopes.js";
export * from "./goldens/generate-golden-artifacts.js";

// Footgun invariant checkers (work item 4) — reusable by 06's own conformance suite.
export * from "./footguns/invariants.js";

/**
 * `model-routing` — roadmap/06-claude-engine-adapter.md §In scope, "Spawn
 * path": "model routed per role (balanced defaults, overrides only via
 * approved envelope)". Per-role dispatch is phase 13's own decision
 * (`ClaudeEngineAdapterConfig.model`, `adapter-config.ts`'s own doc
 * comment: "Routing per role is the caller's decision … 13 owns
 * dispatch"); this module only supplies the balanced default used when no
 * override is supplied, and applies whichever override the caller passes.
 */

/**
 * The balanced default model for implementation workers (adaptation §0's
 * confirmed transport/model-routing decision record — a balanced default,
 * not the deepest-reasoning tier, for ordinary implementation work).
 */
export const DEFAULT_WORKER_MODEL = "sonnet";

/**
 * Resolves the model this worker's `Options.model` should carry: the
 * caller-supplied override if present, otherwise `DEFAULT_WORKER_MODEL`.
 * This function makes no routing DECISION of its own — it only applies
 * whatever value 13's per-role dispatch (or this package's own
 * construction-time config, `ClaudeEngineAdapterConfig.model`) already
 * chose.
 */
export function resolveWorkerModel(model?: string): string {
  return model ?? DEFAULT_WORKER_MODEL;
}

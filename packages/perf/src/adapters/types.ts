import type { ResourceCaptureArtifact } from "../measurement/schema.js";

/**
 * `BenchmarkAdapter` — the documented extension point roadmap/15 §In scope,
 * "Adapters" requires: "generic command benchmark … + a purpose-built Node
 * harness; documented extension point for further stacks." A future
 * ecosystem-specific adapter (e.g. a Python `pytest-benchmark` adapter, a
 * Go `testing.B` adapter) implements exactly this interface — one
 * `run()` call per repetition, given the worktree to run in, returning one
 * `ResourceCaptureArtifact`. Adapters never see the twin-worktree runner's
 * scheduling/interleaving logic (`../runner/twin-worktree-runner.ts`) at
 * all — they are a pure "run once here, tell me what it cost" primitive,
 * called once per repetition by the runner.
 */
export interface BenchmarkAdapter {
  /** A short, stable name for this adapter (e.g. `"generic-command"`, `"node-harness"`) — carried into evidence/diagnostics, never into the `ResourceCaptureArtifact` itself. */
  readonly name: string;
  run(params: BenchmarkAdapterRunParams): Promise<ResourceCaptureArtifact>;
}

export interface BenchmarkAdapterRunParams {
  /** The worktree directory this repetition must run in (13's provisioning — see the twin-worktree runner's own doc comment for why this phase never resolves it itself). */
  readonly cwd: string;
}

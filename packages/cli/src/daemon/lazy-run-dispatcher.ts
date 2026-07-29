/**
 * Defers loading the real, engine-bearing `RunDispatcher` until a run is
 * actually dispatched.
 *
 * roadmap/05 §Idle resource budget: "<100 MiB RSS", and the phase summary's
 * statement of intent — the daemon "holds its own idle footprint to a
 * fixed, CI-measured budget so running it costs nothing when there is no
 * work."
 *
 * `run-dispatcher.ts` statically imports `@crabgic/engine-claude`, which pulls
 * `@anthropic-ai/claude-agent-sdk`. Importing it at boot cost +40.9 MiB and
 * put the daemon's idle RSS at 99.8 / 108.2 / 100.2 MiB across three boots
 * — straddling its own budget — even though an idle daemon serving
 * status/cancel/evidence/registry never touches the engine. Idle RSS is
 * otherwise perfectly flat after boot, so the footprint IS the module
 * graph, not a leak.
 *
 * `RunDispatcher.dispatch` is already async and resolves on ownership
 * rather than completion, so the one-time import lands inside a call that
 * was always asynchronous, and is immaterial against a run measured in
 * hours.
 *
 * `@crabgic/supervisor`'s `createRunDispatcher` hook is synchronous, so the
 * laziness has to live behind `dispatch` rather than in the factory.
 */
import type { RunDispatcher, RunDispatchOutcome } from "@crabgic/supervisor";
import type { RealRunDispatcherOptions } from "./run-dispatcher.js";

/** The slice of `./run-dispatcher.js` this wrapper needs — the seam tests substitute. */
export interface RunDispatcherModule {
  readonly createRealRunDispatcher: (options: RealRunDispatcherOptions) => RunDispatcher;
}

export type RunDispatcherLoader = () => Promise<RunDispatcherModule>;

/**
 * The production loader. Named and exported ON PURPOSE: deferring the
 * import also defers the only check that this specifier resolves at all. It
 * used to be a static import, which the compiler and the daemon's own boot
 * would catch immediately; now a wrong path would surface only on the first
 * real dispatch. Its own test keeps that failure at build time.
 */
export function loadRunDispatcherModule(): Promise<RunDispatcherModule> {
  return import("./run-dispatcher.js");
}

/**
 * Wraps `createRealRunDispatcher` so the module — and the engine behind it
 * — is imported on first dispatch instead of at composition time.
 *
 * Exactly one real dispatcher is ever built. That is a correctness
 * requirement, not an optimization: the real dispatcher keeps its in-flight
 * run set in per-instance state to stay idempotent per run, so a second
 * instance could start a competing driver over the same work units.
 */
export function createLazyRunDispatcher(
  options: RealRunDispatcherOptions,
  load: RunDispatcherLoader = loadRunDispatcherModule,
): RunDispatcher {
  let pending: Promise<RunDispatcher> | undefined;
  let real: RunDispatcher | undefined;

  /**
   * Resolves the one real dispatcher, loading the engine on first use.
   *
   * Shared by both methods so that `resume` gets the SAME instance
   * `dispatch` did. Two instances would each keep their own in-flight set,
   * which is the state that stops a competing driver starting over the same
   * work units — so a second instance is a correctness bug, not a waste.
   */
  async function resolveReal(): Promise<RunDispatcher> {
    if (real !== undefined) return real;
    // Memoize the PROMISE, not just the result, so concurrent first
    // dispatches share one load and one instance instead of racing.
    pending ??= load().then((module) => module.createRealRunDispatcher(options));
    try {
      real = await pending;
    } catch (err) {
      // A failed load must not poison the daemon permanently: clear the
      // memo so a later dispatch can try again. Only load failures reset
      // it — a rejection from `dispatch` itself belongs to the caller.
      pending = undefined;
      throw err;
    }
    return real;
  }

  return {
    async dispatch(changeSetId: string): Promise<RunDispatchOutcome> {
      return (await resolveReal()).dispatch(changeSetId);
    },
    async resume(runId: string): Promise<RunDispatchOutcome> {
      return (await resolveReal()).resume(runId);
    },
  };
}

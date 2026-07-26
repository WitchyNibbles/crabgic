/**
 * The seam through which an approved DAG is actually executed.
 *
 * roadmap/13 §Goal: "the DAG approved in 11 executes to completion without
 * further human intervention". 13 built the loop (`driveRun`) and 11 built
 * intake, but nothing joined them — `run` persisted a ChangeSet and its
 * WorkUnits and stopped there. `run.dispatch` is that join, and the daemon
 * is where it belongs:
 *
 *   - `driveRun` registers every in-flight attempt into `liveWorkers`, the
 *     same map `worker.terminate` reads. Driving from the CLI process would
 *     leave `worker.terminate` unable to reach the workers of a run whose
 *     launching process has already exited.
 *   - roadmap/05 owns worker lifecycle; a run must outlive the terminal
 *     that started it.
 *
 * This package deliberately declares only the INTERFACE. The real
 * implementation needs `@crabgic/engine-claude` (for `ClaudeEngineAdapter`) and
 * `@crabgic/scheduler` (for `driveRun`), and `@crabgic/engine-claude` already depends
 * on this package — constructing it here would be a dependency cycle. The
 * daemon entry point in `packages/cli` composes the real one and injects it,
 * exactly as `driveRun` itself takes `createAdapter` as a seam rather than
 * importing an engine.
 */

export interface RunDispatchOutcome {
  /**
   * Whether the daemon took ownership of driving this run. `false` is a
   * normal, expected answer (already in flight, unknown run, no dispatcher
   * configured) — never an error condition.
   */
  readonly accepted: boolean;
  /** Why it was refused. Present only when `accepted` is false. */
  readonly reason?: string;
}

export interface RunDispatcher {
  /**
   * Begins driving `runId`'s DAG and resolves as soon as ownership is
   * decided — NOT when the run finishes.
   *
   * This is the contract that keeps the control plane responsive: a run can
   * take hours, and `status`/`cancel` are exactly what an operator reaches
   * for while one is in flight. An implementation that awaited completion
   * here would hold the UDS request open for the whole run and make those
   * two operations unanswerable.
   *
   * Implementations must be idempotent per run: dispatching a run that is
   * already in flight returns `{ accepted: false }` rather than starting a
   * second, competing driver over the same work units.
   */
  dispatch(runId: string): Promise<RunDispatchOutcome>;
}

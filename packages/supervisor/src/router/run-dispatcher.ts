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
   * normal, expected answer (already in flight, not approved, no work units,
   * outside the standing policy, no dispatcher configured) — never an error
   * condition.
   */
  readonly accepted: boolean;
  /**
   * The run this call created. Present iff `accepted`.
   *
   * Dispatch is where a run comes into existence (ledger Gap 18): the caller
   * supplies a ChangeSet and receives the id it will use for `status`,
   * `cancel` and `resume`. Nothing else in the system mints one.
   */
  readonly runId?: string;
  /**
   * Why it was refused. Present only when `accepted` is false, and written
   * for an owner rather than a log — a refusal on policy grounds must say
   * which authority escaped, since fixing it means editing a file the caller
   * cannot reach.
   */
  readonly reason?: string;
}

export interface RunDispatcher {
  /**
   * Creates a run for an approved `changeSetId` and begins driving its DAG,
   * resolving as soon as ownership is decided — NOT when the run finishes.
   *
   * This is the contract that keeps the control plane responsive: a run can
   * take hours, and `status`/`cancel` are exactly what an operator reaches
   * for while one is in flight. An implementation that awaited completion
   * here would hold the UDS request open for the whole run and make those
   * two operations unanswerable.
   *
   * Implementations must be idempotent per CHANGE SET: dispatching one whose
   * run is already in flight returns `{ accepted: false }` rather than
   * creating a second run competing over the same work units. Keying this on
   * the change set rather than the run is forced by the signature — the
   * caller has no runId yet, and inventing one to discover it was a duplicate
   * would journal a run that should never have existed.
   */
  dispatch(changeSetId: string): Promise<RunDispatchOutcome>;

  /**
   * Re-drives a run that already exists, for crash recovery and for
   * re-dispatch after a limit park. Same ownership-not-completion contract as
   * `dispatch`.
   */
  resume(runId: string): Promise<RunDispatchOutcome>;

  /**
   * Stops accepting new work and waits for every detached drive to settle —
   * the graceful-shutdown half of the ownership-not-completion contract
   * above, and roadmap/05 §Lifecycle's "clean shutdown drains workers before
   * exit".
   *
   * WHY THIS IS ON THE INTERFACE rather than a convenience on one
   * implementation: the boot layer (`../compose/boot-supervisor.ts`) cannot
   * release the project lease until it holds. That lease is the journal's
   * ONLY single-writer guarantee — `appendEntry` takes no lock — so releasing
   * it while a detached drive is still appending hands the chain to whichever
   * daemon the next CLI call spawns, and two appenders produce a duplicate
   * `seq`/`prevHash` that `repairJournal` classifies as TAMPER rather than as
   * a torn tail. `drain` is what makes "release the lease last" expressible.
   *
   * ONE-WAY DOOR. Once drained, `dispatch`/`resume` refuse permanently with
   * `DISPATCHER_DRAINING_REASON`. Re-opening would let a dispatch start a
   * drive after the caller had already released the lease, which is the race
   * this exists to close. Implementations must be idempotent.
   */
  drain(options?: DrainOptions): Promise<DrainOutcome>;
}

export interface DrainOptions {
  /** How long to wait for in-flight drives to settle on their own before terminating their workers. */
  readonly timeoutMs?: number;
  /** The grace window handed to each live worker's `terminate` at the deadline, and the window allowed for its drive to unwind afterwards. */
  readonly graceMs?: number;
}

/**
 * What a drain actually achieved, partitioned by how each in-flight run ended.
 * Every run in flight when `drain` was called appears in exactly one list.
 */
export interface DrainOutcome {
  /** Drives that finished on their own inside the deadline. Nothing was interrupted. */
  readonly settledRunIds: readonly string[];
  /**
   * Drives cut off at the deadline: their live workers were terminated and the
   * run was journaled to a terminal state, so restart recovery sees an
   * explicitly-ended run rather than a phantom `running` one whose units are
   * all terminal — a run nothing can finish and whose change set nothing can
   * re-dispatch.
   *
   * "Cut off" is decided by the DEADLINE, not by how the drive then unwound. A
   * drive that reacts to its worker's termination and finishes inside the
   * grace window still lands here, and is still journaled terminal, even
   * though its own last act may have been an orderly `completed`/`parked`.
   * That is deliberate: it did not run to the end its caller asked for, it ran
   * to the end shutdown imposed on it, and a run recorded as merely `parked`
   * would keep its change set un-dispatchable while waiting for a session no
   * daemon holds.
   */
  readonly cancelledRunIds: readonly string[];
  /**
   * Drives STILL live after both the deadline and the termination window.
   * Nothing is journaled for these: a second appender beside a live one is the
   * corruption drain exists to prevent. A caller holding the single-writer
   * lease MUST NOT release it when this list is non-empty — the lease's own
   * PID/start-time takeover is the safe reclaim path for a writer that never
   * stopped.
   */
  readonly unsettledRunIds: readonly string[];
}

/**
 * The single refusal a drained dispatcher answers with. A shared constant
 * rather than a per-site string so callers (and tests) can recognise "the
 * daemon is going down" without pattern-matching prose, and without widening
 * `RunDispatchResultSchema`'s wire shape to carry a discriminator.
 */
export const DISPATCHER_DRAINING_REASON =
  "the supervisor is shutting down: its run dispatcher is draining and is not accepting new work";

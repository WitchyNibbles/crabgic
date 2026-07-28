/**
 * Run-lifecycle transition surface — roadmap/05-supervisor-daemon.md
 * §Interfaces produced: "this phase transitions [the run registry]
 * directly on the paths it owns (start/crash/shutdown), and exposes the
 * identical mechanism for 11's stop-condition detectors and, later, 13's
 * dispatch loop to drive existing 02 run-lifecycle transitions from inside
 * `packages/supervisor` — no second transition table, no new state-machine
 * states." CLAUDE.md's own non-negotiable: "validate transitions BEFORE
 * calling appendEntry." Ordering here is therefore: validate (throws
 * `IllegalTransitionError` synchronously, no journal write at all on an
 * illegal transition) -> journal `run_transition` -> update the
 * `RunsRegistry` — journal-first, registry second, matching every other
 * externally-visible-effect ordering this package follows.
 */
import { runLifecycleTransition, type RunLifecycleState } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import type { RunRecord } from "../router/operations.js";
import type { RunsRegistry } from "../registries/runs-registry.js";

export interface TransitionRunOptions {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly runId: string;
  readonly changeSetId: string;
  readonly to: RunLifecycleState;
}

const INITIAL_RUN_STATE: RunLifecycleState = "draft";

/**
 * Transitions `runId` to `to`. Validates against the existing 02
 * run-lifecycle transition table BEFORE any journal write; a run with no
 * prior `RunRecord` is treated as starting from `draft` (matching 02's own
 * run-lifecycle initial state).
 */
/**
 * Per-run write queues, scoped to the registry they belong to.
 *
 * ROAST ROUND 2, F3 — PROVEN. This function reads `from` and then `await`s a
 * journal append before upserting: a read-modify-write straddling an await.
 * Two concurrent transitions on one run both saw the same `from`, both
 * validated against it, and both wrote — putting two outgoing edges from a
 * single state into the record this module's own doc comment calls the audit
 * record. `createRun` performs three of these back to back and `run.cancel`
 * racing that walk is the ordinary way to hit it; which value survived was
 * decided by filesystem append order.
 *
 * Keyed by REGISTRY first, then run. A module-global keyed only by `runId`
 * would make two independent registries (every test that builds its own, and
 * any future embedding) serialize against each other and, worse, share a
 * queue for ids that name different runs.
 *
 * THE PER-RUN ENTRY IS DELETED WHEN IT DRAINS, and that is the part that
 * actually bounds memory. An earlier version of this comment claimed the
 * `WeakMap` made a discarded registry's queues collectable "rather than a
 * permanent leak in a long-lived daemon" — roast round 3 (F8) pointed out
 * that `composeSupervisor` creates exactly ONE registry for the daemon's
 * whole lifetime, so it is never discarded and the leak named was the leak
 * present: one settled promise, holding its resolved `RunRecord`, retained
 * per run for ever.
 *
 * Serialization is PER RUN, not global: two different runs transitioning at
 * once is normal and correct, and queueing them behind one another would turn
 * a correctness fix into a throughput bug.
 */
/** Exported ONLY so the drain contract is assertable — no production caller. */
export const WRITE_QUEUES_FOR_TEST = new WeakMap<RunsRegistry, Map<string, Promise<unknown>>>();
const WRITE_QUEUES = WRITE_QUEUES_FOR_TEST;

function enqueue<T>(runs: RunsRegistry, runId: string, work: () => Promise<T>): Promise<T> {
  let queues = WRITE_QUEUES.get(runs);
  if (queues === undefined) {
    queues = new Map();
    WRITE_QUEUES.set(runs, queues);
  }

  const previous = queues.get(runId) ?? Promise.resolve();
  // `.then(work, work)` rather than `.finally`: a failed transition must not
  // poison every later one for the same run. `IllegalTransitionError` is an
  // ordinary, expected outcome here — it is exactly what the loser of a race
  // receives — so the queue has to survive it.
  // The cleanup is part of the promise the caller awaits, not a detached
  // chain off it. A detached `.finally` runs a microtask AFTER the caller's
  // await has already resolved, so "the queue has drained" would be true only
  // eventually — untestable, and briefly wrong for anyone inspecting it.
  // `const`, and referenced inside its own initializer on purpose: the arrow
  // body only runs once the promise settles, by which time the binding is
  // initialized.
  const next: Promise<T> = previous.then(work, work).finally(() => {
    // Only when nothing has queued behind us: a successor's `previous` IS
    // this promise, and deleting the entry then would let a third caller
    // start a second, parallel chain for the same run.
    if (queues.get(runId) === next) queues.delete(runId);
  });
  queues.set(runId, next);
  return next;
}

/**
 * Transitions `runId` to `to`, serialized against every other transition for
 * the same run.
 *
 * Validates against 02's transition table before any journal write; a run
 * with no prior `RunRecord` starts from `draft`. An illegal transition
 * REJECTS rather than throwing synchronously — the validation now happens
 * inside the queued critical section, so the error surfaces through the
 * returned promise. Every call site awaits, so this is a difference in shape
 * rather than in behaviour, but it is a real one and is stated rather than
 * left for someone to discover.
 */
export function transitionRun(options: TransitionRunOptions): Promise<RunRecord> {
  return enqueue(options.runs, options.runId, () => transitionRunExclusive(options));
}

/** The critical section: reads `from`, validates, journals, upserts — with no other transition for this run interleaved. */
async function transitionRunExclusive(options: TransitionRunOptions): Promise<RunRecord> {
  const current = options.runs.get(options.runId);
  const from = current?.runState ?? INITIAL_RUN_STATE;

  // Rejects with IllegalTransitionError — no appendEntry call is ever
  // reached for an illegal transition. (Synchronous at THIS function's
  // boundary; the exported `transitionRun` wraps it in a queue, so callers
  // observe a rejected promise.)
  runLifecycleTransition(from, options.to);

  const entry = await options.journal.appendEntry({
    type: "run_transition",
    runId: options.runId,
    changeSetId: options.changeSetId,
    payload: { from, to: options.to },
  });

  const record: RunRecord = {
    runId: options.runId,
    changeSetId: options.changeSetId,
    runState: options.to,
    updatedAt: entry.timestamp,
  };
  options.runs.upsert(record);
  return record;
}

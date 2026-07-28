/**
 * Creating a run for an approved `ChangeSet` — the join that was missing.
 *
 * WHY THIS MODULE EXISTS. Until 2026-07-28 nothing in the system ever
 * created a `RunRecord`. `transitionRun` (`./run-transition.ts`) was
 * reachable from exactly two call sites — `run.cancel` and
 * `haltOnStopCondition` — and **both operate on a run that already exists**.
 * The consequence was total rather than partial: an intake could build a
 * `ChangeSet`, its DAG and its envelope, be approved all the way to `ready`,
 * and then have no execution path at all. `run.dispatch` answered "unknown
 * run" for every id an operator could supply, and `status` printed `no runs`
 * immediately after a complete, successful approval. Everything downstream —
 * worktrees, workers, gates, publication — was built, tested, and
 * unreachable. Verified against the built binary before this was written.
 *
 * THE VESTIGIAL PREFIX IS DELIBERATE. `draft → running` is not an edge in
 * 02's `RUN_LIFECYCLE_TRANSITIONS`, and this module does not add one. That
 * enum and its table are pinned by interface-ledger Gap 4, so widening the
 * table for convenience here would be exactly the kind of uncoordinated
 * interface edit `CLAUDE.md` forbids. A run therefore walks
 * `draft → awaiting_approval → ready → running` in one shot. Under ledger
 * Gap 18 there is no per-run approval left for it to wait in
 * `awaiting_approval` for — which is why the walk is instantaneous, and why
 * the states are vestigial rather than wrong. They stay because the run's
 * journal is the audit record, and a record that skipped states its own
 * table declares would be harder to reason about than one that walks them.
 */
import { isRunLifecycleAbsorbing, type ChangeSet } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import type { RunRecord } from "../router/operations.js";
import type { RunsRegistry } from "../registries/runs-registry.js";
import type { Registry } from "../registries/registry.js";
import { transitionRun } from "./run-transition.js";

/** The ordered walk from a fresh run to an executing one — see the file-level note on why it is not a single hop. */
const LIFECYCLE_WALK = ["awaiting_approval", "ready", "running"] as const;

/** Shared so the caller's refusal reason and this module's thrown message can never drift apart. */
export function NOT_READY_REASON(changeSetId: string, state: string): string {
  return `change set "${changeSetId}" is ${state}, not ready — it has not been approved for dispatch`;
}

export interface CreateRunOptions {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly changeSets: Pick<Registry<ChangeSet>, "get">;
  readonly changeSetId: string;
  /**
   * Caller-supplied, matching `IntakeRequest.id`'s own convention: the
   * caller controls id provenance, so tests get deterministic ids and
   * production passes `crypto.randomUUID()`.
   */
  readonly runId: string;
}

/**
 * Creates a run for `changeSetId` and leaves it in `running`.
 *
 * Refuses — before any journal write — when the ChangeSet is unknown or has
 * not reached `ready`. That ordering matters: `ready` is the state only a
 * satisfied approval gate produces, so dispatching from any other state
 * would execute work no human ever authorized. The check is therefore a
 * security boundary, not an input validation, and it is why nothing is
 * journaled on the refusal path.
 *
 * Callers must check {@link findLiveRunForChangeSet} first. This function
 * deliberately does not: a second run over the same work units is a
 * scheduling decision, and the registry is keyed by `runId`, so it cannot
 * detect the duplicate on its own except when the same `runId` is reused
 * (which the transition table then refuses on its own terms).
 */
export async function createRun(options: CreateRunOptions): Promise<RunRecord> {
  const changeSet = options.changeSets.get(options.changeSetId);
  if (changeSet === undefined) {
    throw new Error(`unknown change set "${options.changeSetId}"`);
  }
  // DENY BY DEFAULT — never a list of disallowed states. `ChangeSet.state` is
  // `RunLifecycleStateSchema`, the same 11-member union a run uses, so a
  // "not draft and not awaiting_approval" formulation would admit
  // `cancelled`, `blocked`, `failed` and `published_local`: it would dispatch
  // a change set the owner had explicitly stopped. `ready` is the single
  // state a satisfied approval gate produces, and every other member —
  // including any added to that union later — must fail closed.
  if (changeSet.state !== "ready") {
    throw new Error(NOT_READY_REASON(options.changeSetId, changeSet.state));
  }

  let record!: RunRecord;
  for (const to of LIFECYCLE_WALK) {
    record = await transitionRun({
      journal: options.journal,
      runs: options.runs,
      runId: options.runId,
      changeSetId: options.changeSetId,
      to,
    });
  }
  return record;
}

/**
 * The run still in flight for `changeSetId`, if any.
 *
 * "In flight" is the complement of 02's `isRunLifecycleAbsorbing` — the four
 * states with no outgoing edges. Using absorption rather than the narrower
 * `isRunLifecycleTerminal` is deliberate: `published_local` is a *successful*
 * end state and is not one of the three named terminals, but a change set
 * that has already published is just as finished as one that failed. Testing
 * for "has any record" instead would make a change set permanently
 * un-runnable after its first failure.
 */
export function findLiveRunForChangeSet(
  runs: RunsRegistry,
  changeSetId: string,
): RunRecord | undefined {
  return runs
    .list()
    .find((run) => run.changeSetId === changeSetId && !isRunLifecycleAbsorbing(run.runState));
}

/**
 * The run that already **published** for `changeSetId`, if any.
 *
 * Roast round 2 (F2): nothing ever moves a `ChangeSet` out of `ready` — the
 * only writers are the intake pipeline, the amendment flow and the
 * ready-transition, and the dispatch/drive path never writes one. So `ready`
 * behaves as a REUSABLE dispatch ticket: once a run reaches `published_local`
 * and its drive settles, the change set is no longer "live", is still
 * `ready`, and dispatching again mints a second run that re-executes and
 * re-publishes already-published work with no human anywhere in the loop.
 *
 * Retrying after `failed`, `blocked` or `cancelled` is legitimate and stays
 * allowed — that is why `findLiveRunForChangeSet` treats all four absorbing
 * states as finished. Re-publishing a success is not, so it is separated out
 * rather than folded into that predicate.
 */
export function findPublishedRunForChangeSet(
  runs: RunsRegistry,
  changeSetId: string,
): RunRecord | undefined {
  return runs
    .list()
    .find((run) => run.changeSetId === changeSetId && run.runState === "published_local");
}

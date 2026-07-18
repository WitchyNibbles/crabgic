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
import { runLifecycleTransition, type RunLifecycleState } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
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
export async function transitionRun(options: TransitionRunOptions): Promise<RunRecord> {
  const current = options.runs.get(options.runId);
  const from = current?.runState ?? INITIAL_RUN_STATE;

  // Throws IllegalTransitionError synchronously — no appendEntry call is
  // ever reached for an illegal transition.
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

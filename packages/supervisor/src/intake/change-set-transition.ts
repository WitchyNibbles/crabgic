/**
 * `ChangeSet.state` transition surface — the `ChangeSet`-scoped twin of
 * `../run-lifecycle/run-transition.ts`, reusing the IDENTICAL `@eo/contracts`
 * run-lifecycle transition table/validator (never a second state machine —
 * roadmap/11-intake-contract-approval.md §Interfaces produced item 9: "no
 * new state-machine states are added — 02's enum is unchanged"). A
 * `ChangeSet`'s own `state` field is a distinct piece of durable state from
 * any `Run` record (`../registries/runs-registry.ts`) — at intake time, no
 * `Run` exists yet (a `Run` is created once 13 starts dispatching against a
 * `ready` `ChangeSet`), so this module transitions the `ChangeSet` record
 * itself via `../registries/change-sets-registry.ts`, journaling the same
 * `run_transition` entry type correlated by `changeSetId` (the envelope's
 * `runId` field is optional — see `@eo/journal`'s `journal-entry.ts` — and
 * is left unset here, matching "no Run exists yet").
 */
import { runLifecycleTransition, type ChangeSet, type RunLifecycleState } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
import type { Registry } from "../registries/registry.js";

export interface TransitionChangeSetOptions {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly changeSetId: string;
  readonly to: RunLifecycleState;
}

export class ChangeSetNotFoundError extends Error {
  constructor(changeSetId: string) {
    super(`intake: no ChangeSet found for id "${changeSetId}"`);
    this.name = "ChangeSetNotFoundError";
  }
}

/**
 * Transitions `changeSetId`'s own `state` field. Validates against the
 * shared run-lifecycle transition table BEFORE any journal write (matching
 * `transitionRun`'s own journal-first-after-validation ordering) — an
 * illegal transition throws `IllegalTransitionError` (`@eo/contracts`)
 * synchronously with no journal write at all. Throws
 * `ChangeSetNotFoundError` for an unknown id (never an implicit `draft`
 * fallback — unlike a fresh `Run`, a `ChangeSet` must already exist:
 * `./intake-pipeline.ts` creates it directly at `draft`, this function only
 * ever transitions an existing record).
 */
export async function transitionChangeSet(options: TransitionChangeSetOptions): Promise<ChangeSet> {
  const current = options.changeSets.get(options.changeSetId);
  if (current === undefined) {
    throw new ChangeSetNotFoundError(options.changeSetId);
  }

  runLifecycleTransition(current.state, options.to);

  await options.journal.appendEntry({
    type: "run_transition",
    changeSetId: options.changeSetId,
    payload: { from: current.state, to: options.to },
  });

  const updated: ChangeSet = { ...current, state: options.to };
  options.changeSets.put(updated);
  return updated;
}

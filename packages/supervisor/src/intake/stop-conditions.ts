/**
 * Stop-condition detectors — roadmap/11-intake-contract-approval.md §Goal:
 * "any of seven named stop conditions forces a fresh approval instead of
 * silent continuation"; §In scope, "Stop conditions enforced": "material
 * amendment, expanded authority, critical security issue, unsafe overlap,
 * irreducible product decision, exhausted repairs, blocking verification."
 * §Interfaces produced item 9: "drive existing 02 run-lifecycle
 * transitions (-> `blocked` or -> `awaiting_approval`) inside
 * `packages/supervisor`; no new state-machine states are added."
 *
 * TARGET-STATE DECISION (documented, since the source material names two
 * possible targets without pinning which condition maps to which): 02's
 * own transition table (`@eo/contracts`'s `RUN_LIFECYCLE_TRANSITIONS`) only
 * allows `-> awaiting_approval` FROM `draft` — no in-flight stage
 * (`ready`/`running`/`verifying`/`integrating`/`final_verifying`) has an
 * outgoing edge to `awaiting_approval`; every one of those stages CAN
 * legally reach `blocked`. So: a stop condition firing during intake
 * (before the `ChangeSet` ever leaves `draft`) is naturally already headed
 * toward `awaiting_approval` — the ordinary intake-completion transition,
 * not a special "halt" one. A stop condition firing against an IN-FLIGHT
 * run (this module's actual subject — 13's dispatch loop calls this once
 * it exists) has exactly one legal non-success target across every
 * in-flight stage: `blocked`. All 7 conditions therefore drive the SAME
 * `-> blocked` transition when applied to an in-flight `Run` — the
 * "material amendment"/"expanded authority"/"irreducible product decision"
 * conditions' own "fresh approval" semantics are satisfied by 11's
 * amendment flow (`./amendment.ts`) producing a new envelope + invalidated
 * token for a FUTURE re-dispatch, not by resurrecting the blocked run
 * in-place (flagged as 13's own hand-off concern, roadmap/11 §Risks).
 */
import type { JournalStore } from "@eo/journal";
import type { RunRecord } from "../router/operations.js";
import type { RunsRegistry } from "../registries/runs-registry.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";

export const STOP_CONDITION_KINDS = [
  "material_amendment",
  "expanded_authority",
  "critical_security_issue",
  "unsafe_overlap",
  "irreducible_product_decision",
  "exhausted_repairs",
  "blocking_verification",
] as const;
export type StopConditionKind = (typeof STOP_CONDITION_KINDS)[number];

export interface HaltOnStopConditionOptions {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly runId: string;
  readonly changeSetId: string;
  readonly kind: StopConditionKind;
  readonly reason: string;
}

/**
 * Transitions the run to `blocked` via the existing `transitionRun`
 * surface FIRST — the correct transition and no other, for every one of
 * the 7 conditions — then records an `adjudication_decision` entry
 * documenting WHY (the stop condition kind + human-readable reason).
 * Throws `IllegalTransitionError` (via `transitionRun`) if the run is
 * already in a state with no `-> blocked` edge (e.g. already `failed`/
 * `cancelled`/`published_local`) — a stop condition can never resurrect or
 * repeat a halt on an already-terminal run.
 *
 * LOW L7 repair (adversarial-validation finding): the journal write used
 * to happen BEFORE the transition, so an illegal-transition attempt (e.g.
 * halting an already-terminal run) still left a stray `adjudication_
 * decision` record behind for a halt that never actually took effect.
 * Ordering is now transition-first — the decision record is only ever
 * written once the halt has genuinely, successfully happened.
 */
export async function haltOnStopCondition(options: HaltOnStopConditionOptions): Promise<RunRecord> {
  const record = await transitionRun({
    journal: options.journal,
    runs: options.runs,
    runId: options.runId,
    changeSetId: options.changeSetId,
    to: "blocked",
  });

  await options.journal.appendEntry({
    type: "adjudication_decision",
    runId: options.runId,
    changeSetId: options.changeSetId,
    payload: {
      decision: "blocked",
      rationale: `stop condition "${options.kind}": ${options.reason}`,
      subjectId: options.runId,
    },
  });

  return record;
}

/**
 * Fan-out selection + rationale journaling — roadmap/13-scheduler-packets-
 * context.md §In scope, "DAG executor": "default one worker; fan-out only
 * when independence is proven and benefit exceeds coordination cost,
 * rationale journaled (`fanout_rationale`, `JournalEntryType`, 02);
 * concurrency cap 4." §Interfaces produced: "Fan-out rationale records
 * (`fanout_rationale`)... carries expected token cost."
 *
 * `FanoutRationalePayloadSchema` (04's `journal-payloads.ts`) has exactly
 * one field, `rationale: NonEmptyString` — no dedicated numeric
 * token-cost field exists on the closed 02/04 schema (out of this
 * package's authority to add one). The "expected token cost" the roadmap
 * requires is therefore carried as TEXT inside that one field (this
 * phase's own minimal-sufficient choice, matching this repo's established
 * "no field shape is pinned anywhere in cited source material" pattern —
 * see e.g. `@eo/contracts`'s own `WorkUnit.role` doc comment).
 */

import type { WorkUnit } from "@eo/contracts";
import type { CollisionVerdict } from "@eo/git-engine";
import type { JournalStore } from "@eo/journal";
import { buildOverlapAdjacency } from "./readiness.js";

/** Delegation-depth-1 / concurrency-cap-4 (adaptation §3.2; roadmap/13 §In scope) — this phase's own dispatch-time ceiling, never exceeded regardless of how many units are ready. */
export const DEFAULT_CONCURRENCY_CAP = 4;

/** Turns per unit assumed for the expected-token-cost estimate in a fan-out rationale — this phase's own minimal-sufficient constant (no source material pins a real token/turn conversion). */
const ESTIMATED_TURNS_PER_UNIT = 10;

/**
 * Greedily selects a maximal-under-the-cap, PAIRWISE-NON-COLLIDING subset
 * of `readyUnitIds` (in input order — deterministic, stable tie-breaking).
 * This is the property this phase's Exit Criterion #1 demands: "overlapping
 * units never concurrent." A unit that collides with ANY already-selected
 * unit this round is skipped this round (it becomes eligible again once
 * this round's dispatch set has moved off `pending`/into `dispatched`,
 * naturally serializing it via `../readiness.ts`'s own in-flight check on
 * the NEXT round).
 */
export function selectDispatchSet(
  readyUnitIds: readonly string[],
  overlapVerdicts: readonly CollisionVerdict[],
  concurrencyCap: number = DEFAULT_CONCURRENCY_CAP,
): readonly string[] {
  const adjacency = buildOverlapAdjacency(overlapVerdicts);
  const selected: string[] = [];

  for (const candidateId of readyUnitIds) {
    if (selected.length >= concurrencyCap) break;
    const collidesWithSelected = selected.some((chosenId) =>
      (adjacency.get(candidateId) ?? new Set<string>()).has(chosenId),
    );
    if (collidesWithSelected) continue;
    selected.push(candidateId);
  }
  return selected;
}

export interface JournalFanoutRationaleOptions {
  readonly journal: JournalStore;
  readonly dispatchedUnitIds: readonly string[];
  readonly runId?: string;
  readonly changeSetId?: string;
}

/**
 * Journals a `fanout_rationale` entry — but ONLY when `dispatchedUnitIds`
 * names more than one unit (roadmap/13 §Interfaces produced: "journaled
 * whenever the executor fans out beyond one worker"). A single-unit
 * dispatch round is the default, non-fan-out case and journals nothing
 * here (the ordinary `work_unit_transition` "dispatched" entry already
 * covers it).
 */
export async function journalFanoutRationaleIfFannedOut(
  options: JournalFanoutRationaleOptions,
): Promise<void> {
  if (options.dispatchedUnitIds.length <= 1) return;

  const expectedTokenCost = options.dispatchedUnitIds.length * ESTIMATED_TURNS_PER_UNIT;
  const rationale =
    `Fan-out dispatching ${String(options.dispatchedUnitIds.length)} independent work units ` +
    `(${options.dispatchedUnitIds.join(", ")}) concurrently — independence proven by zero pairwise ` +
    `overlap collisions among them this round; expected token cost ~${String(expectedTokenCost)} ` +
    `turns total (${String(ESTIMATED_TURNS_PER_UNIT)} turns/unit estimate).`;

  await options.journal.appendEntry({
    type: "fanout_rationale",
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    ...(options.changeSetId !== undefined ? { changeSetId: options.changeSetId } : {}),
    payload: { rationale },
  });
}

/** Convenience re-export so callers of this module don't need a second `WorkUnit` type import just for typing their own dispatch loop. */
export type { WorkUnit };

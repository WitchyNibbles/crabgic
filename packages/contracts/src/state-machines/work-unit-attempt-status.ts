import { z } from "zod";
import { createTransitionFn, isAbsorbing, type TransitionTable } from "./transition-table.js";

/**
 * `WorkUnitAttemptStatus` (roadmap/02 work item 3; interface-ledger Gap 4):
 * a new, standalone, closed union orthogonal to the run lifecycle — a
 * WorkUnit's attempt can park while its parent Run stays `running`. Own
 * exhaustive transition-table tests, independent of the run-lifecycle
 * suite. Four members (`dispatched`, `succeeded`, `failed`,
 * `parked:rate_limit`) are resolution-mandated; `pending`/`cancelled` are
 * this phase's own discretionary addition per the binding resolution's
 * explicit delegation.
 */
export const WORK_UNIT_ATTEMPT_STATUSES = [
  "pending",
  "dispatched",
  "succeeded",
  "failed",
  "cancelled",
  "parked:rate_limit",
] as const;

export const WorkUnitAttemptStatusSchema = z.enum(WORK_UNIT_ATTEMPT_STATUSES);
export type WorkUnitAttemptStatus = z.infer<typeof WorkUnitAttemptStatusSchema>;

export const WORK_UNIT_ATTEMPT_STATUS_TERMINALS = ["succeeded", "failed", "cancelled"] as const;
export type WorkUnitAttemptStatusTerminal = (typeof WORK_UNIT_ATTEMPT_STATUS_TERMINALS)[number];

/**
 * `pending` moves to `dispatched` or directly to `cancelled`; `dispatched`
 * moves to any of `succeeded`/`failed`/`cancelled`/`parked:rate_limit`;
 * `parked:rate_limit` transitions ONLY to/from `dispatched`;
 * `succeeded`/`failed`/`cancelled` are terminal (absorbing).
 */
export const WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS: TransitionTable<WorkUnitAttemptStatus> = {
  pending: ["dispatched", "cancelled"],
  dispatched: ["succeeded", "failed", "cancelled", "parked:rate_limit"],
  "parked:rate_limit": ["dispatched"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const workUnitAttemptStatusTransition = createTransitionFn(
  "WorkUnitAttemptStatus",
  WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS,
);

export function isWorkUnitAttemptStatusAbsorbing(status: WorkUnitAttemptStatus): boolean {
  return isAbsorbing(WORK_UNIT_ATTEMPT_STATUS_TRANSITIONS, status);
}

export function isWorkUnitAttemptStatusTerminal(
  status: WorkUnitAttemptStatus,
): status is WorkUnitAttemptStatusTerminal {
  return (WORK_UNIT_ATTEMPT_STATUS_TERMINALS as readonly WorkUnitAttemptStatus[]).includes(status);
}

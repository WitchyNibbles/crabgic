import { z } from "zod";
import { createTransitionFn, isAbsorbing, type TransitionTable } from "./transition-table.js";

/**
 * Run-lifecycle closed union (roadmap/02 work item 2; interface-ledger Gap
 * 4 leaves this enum untouched at 8 states + 3 terminals = 11 members):
 * `draft → awaiting_approval → ready → running → verifying → integrating →
 * final_verifying → published_local`, terminals `failed | blocked |
 * cancelled`. `WorkUnitAttemptStatus` (own file) is the orthogonal union
 * that carries `parked:rate_limit` — it is NOT a member here.
 */
export const RUN_LIFECYCLE_STATES = [
  "draft",
  "awaiting_approval",
  "ready",
  "running",
  "verifying",
  "integrating",
  "final_verifying",
  "published_local",
  "failed",
  "blocked",
  "cancelled",
] as const;

export const RunLifecycleStateSchema = z.enum(RUN_LIFECYCLE_STATES);
export type RunLifecycleState = z.infer<typeof RunLifecycleStateSchema>;

/** The 3 states the phase file names "terminals" — see `published_local`'s own note below. */
export const RUN_LIFECYCLE_TERMINAL_STATES = ["failed", "blocked", "cancelled"] as const;
export type RunLifecycleTerminalState = (typeof RUN_LIFECYCLE_TERMINAL_STATES)[number];

/**
 * The transition table. `published_local` is the pipeline's successful end
 * state and has no outgoing edges (it absorbs, like the 3 named
 * terminals), but the phase file's own vocabulary counts it among the "8
 * states," not the "3 terminals" — `isRunLifecycleAbsorbing` below is the
 * general-purpose "has no outgoing edges" predicate that covers all 4;
 * `RUN_LIFECYCLE_TERMINAL_STATES` stays exactly the phase's named 3.
 *
 * Edge design (this phase's own discretionary choice; the phase file
 * mandates only the linear pipeline order and the 3 terminals, not every
 * edge): `awaiting_approval` can resolve to `blocked` (envelope/approval
 * rejected on policy grounds) as well as `ready`/`cancelled`; every
 * in-flight pipeline stage (`running` through `final_verifying`) can end
 * in any of the 3 terminals, matching 16/21's `ambiguous_write → blocked`
 * mapping cited in this phase's "Interfaces produced" section.
 */
export const RUN_LIFECYCLE_TRANSITIONS: TransitionTable<RunLifecycleState> = {
  draft: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["ready", "blocked", "cancelled"],
  ready: ["running", "cancelled"],
  running: ["verifying", "failed", "blocked", "cancelled"],
  verifying: ["integrating", "failed", "blocked", "cancelled"],
  integrating: ["final_verifying", "failed", "blocked", "cancelled"],
  final_verifying: ["published_local", "failed", "blocked", "cancelled"],
  published_local: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export const runLifecycleTransition = createTransitionFn("RunLifecycle", RUN_LIFECYCLE_TRANSITIONS);

/** True for the 3 named terminals AND `published_local` (all 4 have no outgoing edges). */
export function isRunLifecycleAbsorbing(state: RunLifecycleState): boolean {
  return isAbsorbing(RUN_LIFECYCLE_TRANSITIONS, state);
}

/** True only for the phase file's named 3 terminals (excludes `published_local`). */
export function isRunLifecycleTerminal(
  state: RunLifecycleState,
): state is RunLifecycleTerminalState {
  return (RUN_LIFECYCLE_TERMINAL_STATES as readonly RunLifecycleState[]).includes(state);
}

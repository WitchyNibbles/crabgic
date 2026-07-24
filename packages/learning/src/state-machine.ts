import {
  createTransitionFn,
  isAbsorbing,
  IllegalTransitionError,
  type LearningProposalState,
  type TransitionTable,
} from "@eo/contracts";

/**
 * `LearningProposalState` transition table — roadmap/22-learning-system.md
 * §Goal: `observation → reproducer → candidate → dev_eval → held_out_eval →
 * shadow_run → independent_review → promoted|rejected`, with
 * `rolled_back`/`expired` as post-promotion terminals. This module owns the
 * transition-table tests/guards/enforcement for the `LearningProposalState`
 * union `@eo/contracts` (02) defines — exactly the split the roadmap
 * documents for `WorkUnitAttemptStatus` (13 owns that union's transition
 * behavior despite 02 hosting the enum).
 *
 * Reuses `@eo/contracts`'s own `createTransitionFn`/`IllegalTransitionError`
 * (the identical shared primitive `RunLifecycleState`/`WorkUnitAttemptStatus`
 * already build on) rather than inventing a second transition-table engine.
 *
 * EDGE DESIGN (this phase's own discretionary choice — the roadmap mandates
 * only the linear pipeline order and the two post-promotion terminals):
 *
 *   - The linear chain has NO shortcut edges: `independent_review` is
 *     reachable ONLY from `shadow_run`, which is reachable ONLY from
 *     `held_out_eval`, which is reachable ONLY from `dev_eval`. This is the
 *     structural half of the "no sequence reaches `promoted` without both
 *     eval stages and `independent_review`" invariant (roadmap/22 §Test
 *     plan, Property) — it holds by construction of this table alone,
 *     before the second half (two distinct approval tokens, enforced by
 *     `../promotion/promote.ts`, not this table) is even considered.
 *   - Every non-terminal, non-`independent_review` state may transition
 *     directly to `rejected` (a reviewer, or a failing eval/contamination
 *     check, can reject at any stage — roadmap/22 §Test plan, Security:
 *     "rejected promotion changes nothing" is meaningful at every stage,
 *     not just the final one) or `expired` (a referenced `EvidenceRecord`
 *     can go stale at any pipeline stage, roadmap/22 §In scope "Expiry/
 *     rollback").
 *   - `independent_review` transitions ONLY to `promoted` or `rejected` —
 *     no direct `expired` edge, since by this stage the proposal's own
 *     evidence references are the freshest they will ever be relative to
 *     this review cycle; an expiry concern discovered during review is
 *     modeled as a `rejected` verdict with rationale, not a distinct edge.
 *   - `promoted` transitions ONLY to `rolled_back` or `expired` (roadmap/22
 *     §Goal, "`rolled_back`/`expired` as post-promotion terminals").
 *   - `rejected`, `rolled_back`, `expired` are absorbing (no outgoing
 *     edges) — matching every other closed union in this repo's own
 *     terminal-state convention.
 */
export const LEARNING_PROPOSAL_TRANSITIONS: TransitionTable<LearningProposalState> = {
  observation: ["reproducer", "rejected", "expired"],
  reproducer: ["candidate", "rejected", "expired"],
  candidate: ["dev_eval", "rejected", "expired"],
  dev_eval: ["held_out_eval", "rejected", "expired"],
  held_out_eval: ["shadow_run", "rejected", "expired"],
  shadow_run: ["independent_review", "rejected", "expired"],
  independent_review: ["promoted", "rejected"],
  promoted: ["rolled_back", "expired"],
  rejected: [],
  rolled_back: [],
  expired: [],
};

/** Pure `(current, next) -> next` transition function; throws `IllegalTransitionError<LearningProposalState>` on any edge not declared above. Never mutates any external state. */
export const learningProposalTransition = createTransitionFn(
  "LearningProposalState",
  LEARNING_PROPOSAL_TRANSITIONS,
);

/** True for `rejected`/`rolled_back`/`expired` (no outgoing edges). `promoted` is NOT absorbing — it has two legal outgoing edges. */
export function isLearningProposalAbsorbing(state: LearningProposalState): boolean {
  return isAbsorbing(LEARNING_PROPOSAL_TRANSITIONS, state);
}

/** The 3 states with no outgoing transitions — the pipeline's true terminals. */
export const LEARNING_PROPOSAL_ABSORBING_STATES: readonly LearningProposalState[] = [
  "rejected",
  "rolled_back",
  "expired",
];

export { IllegalTransitionError };

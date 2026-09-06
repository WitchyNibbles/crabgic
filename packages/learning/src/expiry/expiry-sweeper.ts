import type { LearningProposal } from "@crabgic/contracts";
import type { ProposalRegistry } from "../proposal-store/registry.js";
import {
  LEARNING_PROPOSAL_ABSORBING_STATES,
  LEARNING_PROPOSAL_TRANSITIONS,
} from "../state-machine.js";

export interface ExpirySweepResult {
  readonly expiredProposalIds: readonly string[];
  /**
   * Proposals the sweep found stale but could NOT expire, because
   * `independent_review` has no `expired` edge. Reported rather than dropped:
   * the whole point of the sweep is that a stale reference does not sit
   * unnoticed, and a silent skip would leave exactly the proposal a human is
   * actively reviewing as the one nobody is told about.
   */
  readonly staleUnderReviewProposalIds: readonly string[];
}

/**
 * Expiry sweeper — roadmap/22-learning-system.md §In scope, "Expiry/
 * rollback": "lessons carry `EvidenceRecord` references; a referenced
 * record going stale (object ID/fingerprint no longer current) raises an
 * expiry proposal." Actual staleness determination (whether a specific
 * `EvidenceRecord`'s `objectId`/fingerprint is still current) is 04/08/14's
 * territory — this module takes it as an injected port
 * (`isEvidenceStale`), never reimplementing object-id-drift detection
 * itself.
 *
 * A proposal in a non-terminal state WITH an `expired` edge (`promoted`
 * included — the state machine's `promoted -> expired` edge exists for exactly
 * this) whose `evidenceRecordIds` contains at least one stale reference is
 * transitioned straight to `expired`, "raising an expiry" by making the
 * transition
 * itself the raised signal (journaled via the registry's own
 * `learning_transition` entry) — this phase's own minimal-sufficient
 * choice over minting a SEPARATE new proposal purely to announce the
 * staleness of an existing one, since the existing proposal's own state
 * already carries that information once it reaches `expired`.
 *
 * `independent_review` is the one non-terminal state without that edge, and
 * the state machine withholds it deliberately: "an expiry concern discovered
 * during review is modeled as a `rejected` verdict with rationale, not a
 * distinct edge." A verdict is the reviewer's act, not the sweeper's, so the
 * sweep reports such a proposal in `staleUnderReviewProposalIds` and leaves
 * the state alone. It used to attempt the transition regardless, which threw
 * `IllegalTransitionError` out of the loop and abandoned every proposal after
 * it in the list.
 */
export async function sweepExpiredProposals(
  registry: ProposalRegistry,
  isEvidenceStale: (evidenceRecordId: string) => Promise<boolean>,
): Promise<ExpirySweepResult> {
  const proposals = await registry.list();
  const expiredProposalIds: string[] = [];
  const staleUnderReviewProposalIds: string[] = [];

  for (const proposal of proposals) {
    if (isTerminal(proposal)) continue;
    if (proposal.evidenceRecordIds.length === 0) continue;

    const staleFlags = await Promise.all(proposal.evidenceRecordIds.map(isEvidenceStale));
    if (!staleFlags.some(Boolean)) continue;

    if (!canExpire(proposal)) {
      staleUnderReviewProposalIds.push(proposal.id);
      continue;
    }

    await registry.transition(proposal.id, "expired");
    expiredProposalIds.push(proposal.id);
  }

  return { expiredProposalIds, staleUnderReviewProposalIds };
}

/** Asks the transition table itself rather than naming states here — a state that gains or loses its `expired` edge must not need this file edited too. */
function canExpire(proposal: LearningProposal): boolean {
  return LEARNING_PROPOSAL_TRANSITIONS[proposal.state].includes("expired");
}

function isTerminal(proposal: LearningProposal): boolean {
  return (LEARNING_PROPOSAL_ABSORBING_STATES as readonly string[]).includes(proposal.state);
}

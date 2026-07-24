import type { LearningProposal } from "@eo/contracts";
import type { ProposalRegistry } from "../proposal-store/registry.js";
import { LEARNING_PROPOSAL_ABSORBING_STATES } from "../state-machine.js";

export interface ExpirySweepResult {
  readonly expiredProposalIds: readonly string[];
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
 * A proposal (in ANY non-terminal state, `promoted` included — the state
 * machine's `promoted -> expired` edge exists for exactly this) whose
 * `evidenceRecordIds` contains at least one stale reference is transitioned
 * straight to `expired`, "raising an expiry" by making the transition
 * itself the raised signal (journaled via the registry's own
 * `learning_transition` entry) — this phase's own minimal-sufficient
 * choice over minting a SEPARATE new proposal purely to announce the
 * staleness of an existing one, since the existing proposal's own state
 * already carries that information once it reaches `expired`.
 */
export async function sweepExpiredProposals(
  registry: ProposalRegistry,
  isEvidenceStale: (evidenceRecordId: string) => Promise<boolean>,
): Promise<ExpirySweepResult> {
  const proposals = await registry.list();
  const expiredProposalIds: string[] = [];

  for (const proposal of proposals) {
    if (isTerminal(proposal)) continue;
    if (proposal.evidenceRecordIds.length === 0) continue;

    const staleFlags = await Promise.all(proposal.evidenceRecordIds.map(isEvidenceStale));
    if (staleFlags.some(Boolean)) {
      await registry.transition(proposal.id, "expired");
      expiredProposalIds.push(proposal.id);
    }
  }

  return { expiredProposalIds };
}

function isTerminal(proposal: LearningProposal): boolean {
  return (LEARNING_PROPOSAL_ABSORBING_STATES as readonly string[]).includes(proposal.state);
}

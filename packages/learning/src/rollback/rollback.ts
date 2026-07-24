import type { ChangeSet, LearningProposal } from "@eo/contracts";
import type { ProposalRegistry } from "../proposal-store/registry.js";
import {
  buildInverseChangeSetForRollback,
  type ChangeSetReferences,
} from "../changeset/build-change-set.js";
import { NotPromotedError } from "../errors.js";

export interface RollbackProposalOptions {
  readonly registry: ProposalRegistry;
  readonly proposalId: string;
  /** Defaults to whatever `../promotion/promote.ts` recorded for this proposal (`ProposalRegistry.getPromotedChangeSetId`) when omitted. */
  readonly promotedChangeSetId?: string;
  readonly changeSetRefs: ChangeSetReferences;
}

export interface RollbackProposalResult {
  readonly proposal: LearningProposal;
  readonly inverseChangeSet: ChangeSet;
}

/**
 * Rolls back a `promoted` proposal — roadmap/22-learning-system.md §In
 * scope, "Expiry/rollback": "promoted-lesson rollback dispatches an
 * inverse `ChangeSet` through the same pipeline and restores prior
 * behavior with journaled rationale." Only legal from `promoted` (the
 * state machine's own `promoted -> rolled_back` edge enforces this);
 * requires the ORIGINAL promotion's `ChangeSet` id so the inverse can name
 * exactly what it reverses.
 */
export async function rollbackProposal(
  options: RollbackProposalOptions,
): Promise<RollbackProposalResult> {
  const current = await options.registry.get(options.proposalId);
  if (current === undefined || current.state !== "promoted") {
    throw new NotPromotedError(options.proposalId, current?.state ?? "unknown");
  }

  const promotedChangeSetId =
    options.promotedChangeSetId ??
    (await options.registry.getPromotedChangeSetId(options.proposalId));
  if (promotedChangeSetId === undefined) {
    throw new NotPromotedError(options.proposalId, current.state);
  }

  const inverseChangeSet = buildInverseChangeSetForRollback(
    current,
    promotedChangeSetId,
    options.changeSetRefs,
  );

  const proposal = await options.registry.transition(options.proposalId, "rolled_back", {
    rollbackChangeSetId: inverseChangeSet.id,
  });

  return { proposal, inverseChangeSet };
}

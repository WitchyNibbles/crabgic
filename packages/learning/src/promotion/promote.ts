import type { ChangeSet, LearningProposal } from "@eo/contracts";
import type { ProposalRegistry } from "../proposal-store/registry.js";
import {
  buildChangeSetForPromotion,
  type ChangeSetReferences,
} from "../changeset/build-change-set.js";

export interface PromoteProposalOptions {
  readonly registry: ProposalRegistry;
  readonly proposalId: string;
  readonly changeSetRefs: ChangeSetReferences;
}

export interface PromoteProposalResult {
  readonly proposal: LearningProposal;
  readonly changeSet: ChangeSet;
}

/**
 * The ONE function that turns an `independent_review` proposal into a
 * `promoted` one AND the `ChangeSet` that carries it through the normal
 * scheduler→gates→publish pipeline (roadmap/22-learning-system.md work
 * item 5). This function itself performs NO dispatch — handing the
 * returned `ChangeSet` to 13/14/08's real pipeline is the caller's
 * responsibility (`packages/cli`'s `learn approve` backend, or a future
 * caller); this keeps `@eo/learning` decoupled from `@eo/scheduler`'s
 * dispatch surface, `@eo/gates`' firing surface, and `@eo/git-engine`'s
 * publish surface all at once, matching roadmap/22 §Out of scope.
 *
 * NO BYPASS (roadmap/22 §Exit criteria: "Project-scoped promotion produces
 * a real `ChangeSet` that clears the SAME gates (14) as any other change
 * before publish (08)"): the returned `ChangeSet` is schema-identical to
 * any other `ChangeSet` in the system (11's own intake pipeline builds the
 * exact same shape) — there is no "learning-flavored" variant, no
 * additional field, no skip-gates marker. `../red-team/no-bypass.
 * redteam.test.ts` proves this by firing the SAME `@eo/gates` registry
 * against it.
 *
 * This function takes NO approvals parameter at all (removed in the
 * adversarial-validation fix, 2026-07-24) — the caller must have already
 * accumulated >= 2 genuinely-verified approvals against this exact
 * proposal via `registry.recordReviewApproval` (each call independently
 * checking authenticity + `learning_review` subject kind + binding to
 * THIS proposal, via an injected `LearningReviewTokenVerifier`) BEFORE
 * calling this function — there is no way to pass a trusted-by-name
 * approvals array here.
 */
export async function promoteProposal(
  options: PromoteProposalOptions,
): Promise<PromoteProposalResult> {
  // `ProposalRegistry.transition` is the sole structural enforcement point
  // — throws `IllegalTransitionError` if the proposal is not currently
  // `independent_review`, and `InsufficientIndependentReviewError`/
  // `DuplicateApprovalTokenError` if this proposal's own ALREADY-VERIFIED
  // `reviewApprovals` don't clear the two-distinct-token bar. This
  // function adds NOTHING to that guard; it only additionally builds the
  // ChangeSet once the guard has passed.
  const proposal = await options.registry.transition(options.proposalId, "promoted");

  const changeSet = buildChangeSetForPromotion(proposal, options.changeSetRefs);
  // Recorded so `../rollback/rollback.ts` can look this up without every
  // caller having to thread the forward ChangeSet id through by hand.
  await options.registry.recordPromotedChangeSetId(proposal.id, changeSet.id);
  return { proposal, changeSet };
}

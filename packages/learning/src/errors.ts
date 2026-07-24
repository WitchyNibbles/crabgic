/**
 * Typed errors — every refusal `@eo/learning` can produce is a distinct,
 * named `Error` subclass, matching the repo-wide "typed errors, never
 * silent swallow" convention (`@eo/scheduler`'s `errors.ts`, `@eo/gates`'s
 * `errors.ts`).
 */

/**
 * Thrown by `../promotion/promote.ts`'s `promoteProposal` when fewer than
 * two independently-verified review approvals are supplied — the
 * structural half of the "no event sequence reaches `promoted` without …
 * two distinct approval-token IDs" invariant (roadmap/22 §Test plan,
 * Property). This is the exact error a direct, no-CLI, in-run call to
 * `promoteProposal` hits (roadmap/22 §Exit criteria: "a test attempting
 * direct promotion-logic invocation from within a running work unit
 * fails").
 */
export class InsufficientIndependentReviewError extends Error {
  constructor(
    readonly proposalId: string,
    readonly approvalCount: number,
  ) {
    super(
      `learning: proposal "${proposalId}" cannot be promoted — independent review requires at ` +
        `least 2 distinct supervisor-issued approval tokens, got ${String(approvalCount)}`,
    );
    this.name = "InsufficientIndependentReviewError";
  }
}

/**
 * Thrown when two (or more) supplied review approvals share the same
 * `tokenId` — a single approval invocation (or a replayed token) can never
 * count twice toward the two-distinct-token requirement.
 */
export class DuplicateApprovalTokenError extends Error {
  constructor(
    readonly proposalId: string,
    readonly tokenId: string,
  ) {
    super(
      `learning: proposal "${proposalId}" cannot be promoted — approval token "${tokenId}" was ` +
        "supplied more than once; two DISTINCT tokens are required, never the same token twice",
    );
    this.name = "DuplicateApprovalTokenError";
  }
}

/** Thrown by `../rollback/rollback.ts` when rollback is attempted on a proposal not currently in the `promoted` state. */
export class NotPromotedError extends Error {
  constructor(
    readonly proposalId: string,
    readonly actualState: string,
  ) {
    super(
      `learning: proposal "${proposalId}" is not "promoted" (currently "${actualState}") — ` +
        "only a promoted proposal can be rolled back",
    );
    this.name = "NotPromotedError";
  }
}

/**
 * Thrown by `../eval/contamination.ts`'s `assertNoContamination` when a
 * dev/held-out case-hash overlap or shared provenance id is detected —
 * roadmap/22 §In scope: "contamination checks (case-hash overlap,
 * provenance)"; §Test plan, Security: "contamination … must be detected
 * before eval runs."
 */
export class ContaminationDetectedError extends Error {
  constructor(
    readonly overlappingCaseHashes: readonly string[],
    readonly overlappingProvenanceIds: readonly string[],
  ) {
    super(
      `learning: contamination detected between dev and held-out case sets — ` +
        `${String(overlappingCaseHashes.length)} overlapping case hash(es), ` +
        `${String(overlappingProvenanceIds.length)} shared provenance id(s); refusing to run eval`,
    );
    this.name = "ContaminationDetectedError";
  }
}

/** Thrown when a proposal id has no record in the registry. */
export class ProposalNotFoundError extends Error {
  constructor(readonly proposalId: string) {
    super(`learning: no proposal found with id "${proposalId}"`);
    this.name = "ProposalNotFoundError";
  }
}

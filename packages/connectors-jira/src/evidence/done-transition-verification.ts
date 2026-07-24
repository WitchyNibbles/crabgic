/**
 * Done-transition verification bridge — additive to phase 18, wiring
 * roadmap/21-connector-evidence-integration.md's evidence-pointer/
 * remote-verification result into `../resource-client/issue-plans.ts`'s
 * `assertDoneTransitionHasEvidence(targetStageIsDone, hasVerificationEvidence)`
 * (18's own guard, whose doc comment already says "Jira `done` only after
 * 21's exact-revision verification passes" — this file supplies that
 * boolean from 21's real pointer-lookup result, rather than a caller
 * hand-computing it ad hoc).
 */
export interface RemoteVerificationPointer {
  readonly remoteResourceId: string;
  readonly confirmedRevision?: string;
}

/**
 * `true` iff a pointer for the expected `RemoteResource` exists AND its
 * confirmed revision exactly matches `expectedRevision` (16/18's read-back-
 * verified value) — an EXACT-revision match, never a "some pointer exists"
 * looseness, matching `assertDoneTransitionHasEvidence`'s own "exact-
 * revision verification" framing.
 */
export function hasExactRevisionVerification(
  pointer: RemoteVerificationPointer | undefined,
  expectedRemoteResourceId: string,
  expectedRevision: string,
): boolean {
  if (pointer === undefined) return false;
  if (pointer.remoteResourceId !== expectedRemoteResourceId) return false;
  return pointer.confirmedRevision === expectedRevision;
}

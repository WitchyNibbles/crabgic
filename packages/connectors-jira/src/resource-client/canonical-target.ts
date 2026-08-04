/**
 * Canonical-target helpers — `RemoteMutationPlan.canonicalTarget` is "an
 * opaque, provider-agnostic identifier for the resource this plan acts
 * on" (P02 doc comment). This connector's own convention (kept internal —
 * no other phase parses these strings): `<resourceKind>:<id>`.
 *
 * `writeSerializationTarget` below is this package's second, deliberate
 * parse site (alongside the two apply clients' own `split(":")`): it
 * derives the SERIALIZATION key from the identity key, which is why the
 * per-kind shapes here are safe to keep distinct.
 */
export function issueTarget(issueKey: string): string {
  return `issue:${issueKey}`;
}

export function boardTarget(boardId: number): string {
  return `board:${boardId}`;
}

export function sprintTarget(sprintId: number): string {
  return `sprint:${sprintId}`;
}

export function commentTarget(issueKey: string, commentId?: string): string {
  return commentId !== undefined
    ? `issue:${issueKey}:comment:${commentId}`
    : `issue:${issueKey}:comment`;
}

export function worklogTarget(issueKey: string): string {
  return `issue:${issueKey}:worklog`;
}

export function attachmentTarget(issueKey: string): string {
  return `issue:${issueKey}:attachment`;
}

const ISSUE_TARGET_PREFIX = "issue:";

/**
 * Derives the WRITE-SERIALIZATION key for a plan's canonical target —
 * roadmap/18 §Exit criteria 10, second clause: "per-issue write order
 * preserved," grounded by §In scope's "per-issue write compliance …
 * cross-worker throttling via 16's gateway-side serialization."
 *
 * Every issue-scoped shape this module mints (`issue:K`,
 * `issue:K:comment`, `issue:K:comment:<id>`, `issue:K:worklog`,
 * `issue:K:attachment`) collapses onto ONE key, `issue:K`, so 16's
 * per-tenant+resource write mutex (`@crabgic/gateway`'s
 * `WriteSerializer`) actually serializes a field update, a comment, a
 * worklog and an attachment upload against each other on the same issue
 * — which is exactly the budget Jira's per-issue write rate limit
 * governs. The criterion is unqualified, so no kind is carved out.
 *
 * Identity is NOT collapsed. `canonicalTarget` remains the marker-
 * reconciliation and audit identifier, and both apply clients parse a
 * `commentId` back out of it (`./jira-mutation-apply-client.ts:199`,
 * `./datacenter/jira-mutation-apply-client-dc.ts:194`). This function is
 * the serialization key only, surfaced to the pipeline through
 * `MutationApplyClient.serializationTarget`.
 *
 * Every non-issue-scoped shape is returned UNCHANGED — board/sprint
 * targets, and the create-shaped targets that name no existing issue
 * (`project:<key>:new-issue`, `project:<key>:new-board`,
 * `board:<id>:new-sprint`, `bulk:<keys>`). Cross-issue parallelism is
 * therefore untouched.
 */
export function writeSerializationTarget(canonicalTarget: string): string {
  if (!canonicalTarget.startsWith(ISSUE_TARGET_PREFIX)) return canonicalTarget;
  const parts = canonicalTarget.split(":");
  const issueKey = parts[1];
  if (issueKey === undefined || issueKey.length === 0) return canonicalTarget;
  return `${ISSUE_TARGET_PREFIX}${issueKey}`;
}

/**
 * Canonical-target helpers — `RemoteMutationPlan.canonicalTarget` is "an
 * opaque, provider-agnostic identifier for the resource this plan acts
 * on" (P02 doc comment). This connector's own convention (kept internal —
 * no other phase parses these strings): `<resourceKind>:<id>`.
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

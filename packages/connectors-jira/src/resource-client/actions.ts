/**
 * `JiraAction` — the closed set of mutating actions this connector can
 * ever build a `RemoteMutationPlan` for (the `action` field on that
 * schema is a free-form `NonEmptyString` at the P02 level; THIS closed
 * union is where phase 18 pins down its own exhaustive vocabulary).
 *
 * By construction, this list contains no delete, no admin
 * (user/permission/workflow-scheme/security-scheme/automation-rule), no
 * impersonation, and no raw-endpoint action — roadmap/18 §In scope: "No
 * deletes, no user/permission/workflow/security/automation admin, no
 * impersonation or caller-supplied author/history, no raw endpoints."
 * `./security/preflight-capability-guard.ts` refuses anything outside this
 * set BEFORE any network I/O is attempted — the closed union is the
 * allowlist, not a convention layered on top of an open string type.
 */
export const JIRA_ACTIONS = [
  "issue.create",
  "issue.update",
  "issue.transition",
  "issue.link",
  "issue.rank",
  "issue.bulkUpdate",
  "issue.bulkTransition",
  "comment.create",
  "comment.update",
  "worklog.create",
  "attachment.upload",
  "board.create",
  "board.update",
  "sprint.create",
  "sprint.start",
  "sprint.complete",
  "sprint.moveIssues",
] as const;

export type JiraAction = (typeof JIRA_ACTIONS)[number];

export function isJiraAction(value: unknown): value is JiraAction {
  return typeof value === "string" && (JIRA_ACTIONS as readonly string[]).includes(value);
}

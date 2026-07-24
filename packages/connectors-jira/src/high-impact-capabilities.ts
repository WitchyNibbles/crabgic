import type { HighImpactCapabilityFlag } from "@eo/contracts";
import type { JiraAction } from "./resource-client/actions.js";

/**
 * The 7-member Jira subset of P02's 11-member `HighImpactCapabilityFlag`
 * enum, byte-identical labels (roadmap/18 §In scope, "High-impact
 * capabilities" bullet, verbatim list).
 */
export const JIRA_HIGH_IMPACT_FLAGS: readonly HighImpactCapabilityFlag[] = [
  "assignment",
  "reporter change",
  "closing transitions",
  "sprint completion",
  "attachments",
  "bulk mutations",
  "issue creation",
];

/**
 * Static action -> required-flag(s) table for the actions that ALWAYS
 * carry a high-impact flag regardless of the specific field diff (issue
 * creation, sprint completion, attachments, bulk mutations). `assignment`,
 * `reporter change`, and `closing transitions` are field/target-dependent
 * (an `issue.update` only needs `assignment`/`reporter change` when THOSE
 * specific fields are in the diff; an `issue.transition` only needs
 * `closing transitions` when the target status resolves to the `done`
 * `JiraWorkflowStage`) — see `requiredCapabilityFlagsForUpdate` /
 * `requiredCapabilityFlagsForTransition` below, which this table does not
 * cover.
 */
const UNCONDITIONAL_ACTION_FLAGS: Readonly<Partial<Record<JiraAction, HighImpactCapabilityFlag>>> =
  {
    "issue.create": "issue creation",
    "sprint.complete": "sprint completion",
    "attachment.upload": "attachments",
    "issue.bulkUpdate": "bulk mutations",
    "issue.bulkTransition": "bulk mutations",
  };

/** Returns the unconditional required flag for `action`, if any (see `UNCONDITIONAL_ACTION_FLAGS`). */
export function unconditionalCapabilityFlagFor(
  action: JiraAction,
): HighImpactCapabilityFlag | undefined {
  return UNCONDITIONAL_ACTION_FLAGS[action];
}

/**
 * `issue.update` requires `assignment`/`reporter change` only when the
 * changed-field set (a caller-supplied list of Jira field IDs/names being
 * written, e.g. `["assignee"]`) touches the corresponding field — never
 * unconditionally, since most issue updates touch neither.
 */
export function requiredCapabilityFlagsForIssueUpdate(
  changedFields: readonly string[],
): readonly HighImpactCapabilityFlag[] {
  const flags: HighImpactCapabilityFlag[] = [];
  if (changedFields.includes("assignee")) flags.push("assignment");
  if (changedFields.includes("reporter")) flags.push("reporter change");
  return flags;
}

/** `issue.transition` requires `closing transitions` only when the target `JiraWorkflowStage` is `done`. */
export function requiredCapabilityFlagsForTransition(
  targetStageIsDone: boolean,
): readonly HighImpactCapabilityFlag[] {
  return targetStageIsDone ? ["closing transitions"] : [];
}

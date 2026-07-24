import { ConnectorError, type RemoteMutationPlan } from "@eo/contracts";
import {
  assertCustomFieldWritesAreDiscovered,
  type FieldMetadataIndex,
} from "../capability/field-metadata.js";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import {
  requiredCapabilityFlagsForIssueUpdate,
  requiredCapabilityFlagsForTransition,
  unconditionalCapabilityFlagFor,
} from "../high-impact-capabilities.js";
import { assertSafeAdfDocument } from "./adf-guard.js";
import { issueTarget } from "./canonical-target.js";
import { buildJiraMutationPlan, type JiraPlanBuildContext } from "./plan-builder.js";

/**
 * roadmap/18 §In scope: "Jira `done` only after 21's exact-revision
 * verification passes." A `done`-targeting transition planned with no
 * verification evidence is refused pre-flight — never a silent no-op,
 * never a guess that evidence exists.
 */
export function assertDoneTransitionHasEvidence(
  targetStageIsDone: boolean,
  hasVerificationEvidence: boolean,
): void {
  if (targetStageIsDone && !hasVerificationEvidence) {
    throw ConnectorError.policyBlocked({
      message:
        "a Jira issue may only transition to a done-mapped status with 21's exact-revision verification evidence attached",
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
}

export interface IssueCreateInput {
  readonly projectKeyOrId: string;
  readonly issueType: string;
  readonly summaryAdf: unknown;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export function planIssueCreate(
  planCtx: JiraPlanBuildContext,
  input: IssueCreateInput,
  fieldMetadataIndex: FieldMetadataIndex,
  envelopeId: string,
): RemoteMutationPlan {
  // HIGH H1 (adversarial-review): every outgoing issue description/
  // summary ADF payload passes through 17's safe-subset validator
  // BEFORE a plan is even built — never raw, regardless of which entry
  // point (generic dispatch vs. a direct `JiraResourceClient` call)
  // supplied it.
  assertSafeAdfDocument(input.summaryAdf, "issue.create summaryAdf");
  assertCustomFieldWritesAreDiscovered(input.fields ?? {}, fieldMetadataIndex);
  const flag = unconditionalCapabilityFlagFor("issue.create");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: `project:${input.projectKeyOrId}:new-issue`,
    action: "issue.create",
    redactedDiff: `create ${input.issueType} in ${input.projectKeyOrId}`,
    desiredStatePayload: input,
    idempotencyKey: `issue.create:${input.projectKeyOrId}:${JSON.stringify(input.fields ?? {})}:${Date.now()}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
    ...(flag !== undefined ? { requiredCapabilityFlags: [flag] } : {}),
  });
}

export function planIssueUpdate(
  planCtx: JiraPlanBuildContext,
  issueKey: string,
  expectedRevision: string,
  fields: Readonly<Record<string, unknown>>,
  fieldMetadataIndex: FieldMetadataIndex,
  envelopeId: string,
): RemoteMutationPlan {
  // HIGH H1 (adversarial-review): `fields.description` — Jira's ADF
  // issue-description field — gets the identical safe-subset guard as
  // `issue.create`'s `summaryAdf`. Absent entirely when this update
  // doesn't touch the description at all.
  if (fields["description"] !== undefined) {
    assertSafeAdfDocument(fields["description"], "issue.update fields.description");
  }
  assertCustomFieldWritesAreDiscovered(fields, fieldMetadataIndex);
  const requiredCapabilityFlags = requiredCapabilityFlagsForIssueUpdate(Object.keys(fields));
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: issueTarget(issueKey),
    action: "issue.update",
    redactedDiff: `update fields [${Object.keys(fields).join(", ")}] on ${issueKey}`,
    desiredStatePayload: fields,
    idempotencyKey: `issue.update:${issueKey}:${expectedRevision}`,
    expectedRemoteRevision: expectedRevision,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
    ...(requiredCapabilityFlags.length > 0 ? { requiredCapabilityFlags } : {}),
  });
}

export function planIssueTransition(
  planCtx: JiraPlanBuildContext,
  issueKey: string,
  expectedRevision: string,
  transitionId: string,
  targetStageIsDone: boolean,
  envelopeId: string,
  hasVerificationEvidence = false,
): RemoteMutationPlan {
  assertDoneTransitionHasEvidence(targetStageIsDone, hasVerificationEvidence);
  const requiredCapabilityFlags = requiredCapabilityFlagsForTransition(targetStageIsDone);
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: issueTarget(issueKey),
    action: "issue.transition",
    redactedDiff: `transition ${issueKey} via transition ${transitionId}`,
    desiredStatePayload: { transitionId },
    idempotencyKey: `issue.transition:${issueKey}:${transitionId}:${expectedRevision}`,
    expectedRemoteRevision: expectedRevision,
    impactClass: targetStageIsDone ? "irreversible" : "reversible",
    rollbackClass: targetStageIsDone ? "manual-reopen" : "version-checked-restore",
    envelopeId,
    ...(requiredCapabilityFlags.length > 0 ? { requiredCapabilityFlags } : {}),
  });
}

export interface IssueLinkInput {
  readonly linkType: string;
  readonly outwardIssueKey: string;
  readonly inwardIssueKey: string;
}

export function planIssueLink(
  planCtx: JiraPlanBuildContext,
  input: IssueLinkInput,
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: issueTarget(input.outwardIssueKey),
    action: "issue.link",
    redactedDiff: `link ${input.outwardIssueKey} -${input.linkType}-> ${input.inwardIssueKey}`,
    desiredStatePayload: input,
    idempotencyKey: `issue.link:${input.outwardIssueKey}:${input.linkType}:${input.inwardIssueKey}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planIssueBulkUpdate(
  planCtx: JiraPlanBuildContext,
  issueKeys: readonly string[],
  fields: Readonly<Record<string, unknown>>,
  fieldMetadataIndex: FieldMetadataIndex,
  envelopeId: string,
): RemoteMutationPlan {
  assertCustomFieldWritesAreDiscovered(fields, fieldMetadataIndex);
  const flag = unconditionalCapabilityFlagFor("issue.bulkUpdate");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: `bulk:${issueKeys.join(",")}`,
    action: "issue.bulkUpdate",
    redactedDiff: `bulk-update ${issueKeys.length} issue(s): fields [${Object.keys(fields).join(", ")}]`,
    desiredStatePayload: { issueKeys, fields },
    idempotencyKey: `issue.bulkUpdate:${issueKeys.join(",")}:${JSON.stringify(fields)}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
    ...(flag !== undefined ? { requiredCapabilityFlags: [flag] } : {}),
  });
}

export function planIssueBulkTransition(
  planCtx: JiraPlanBuildContext,
  issueKeys: readonly string[],
  transitionId: string,
  envelopeId: string,
): RemoteMutationPlan {
  const flag = unconditionalCapabilityFlagFor("issue.bulkTransition");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: `bulk:${issueKeys.join(",")}`,
    action: "issue.bulkTransition",
    redactedDiff: `bulk-transition ${issueKeys.length} issue(s) via ${transitionId}`,
    desiredStatePayload: { issueKeys, transitionId },
    idempotencyKey: `issue.bulkTransition:${issueKeys.join(",")}:${transitionId}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
    ...(flag !== undefined ? { requiredCapabilityFlags: [flag] } : {}),
  });
}

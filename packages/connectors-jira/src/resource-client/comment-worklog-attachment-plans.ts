import { ConnectorError, type RemoteMutationPlan } from "@eo/contracts";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { unconditionalCapabilityFlagFor } from "../high-impact-capabilities.js";
import { containsSecretShapedContent } from "../security/secret-patterns.js";
import { assertSafeAdfDocument } from "./adf-guard.js";
import { attachmentTarget, commentTarget, worklogTarget } from "./canonical-target.js";
import { buildJiraMutationPlan, type JiraPlanBuildContext } from "./plan-builder.js";

export function planCommentCreate(
  planCtx: JiraPlanBuildContext,
  issueKey: string,
  bodyAdf: unknown,
  marker: string,
  envelopeId: string,
): RemoteMutationPlan {
  // HIGH H1 (adversarial-review): the comment body ADF passes through
  // 17's safe-subset validator before this plan is built — the generic
  // `tracker.plan_comment` dispatch path funnels here too, so there is
  // no entry point that skips it.
  assertSafeAdfDocument(bodyAdf, "comment.create bodyAdf");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: commentTarget(issueKey),
    action: "comment.create",
    redactedDiff: `create comment on ${issueKey} (marker ${marker})`,
    desiredStatePayload: { bodyAdf, marker },
    idempotencyKey: `comment.create:${issueKey}:${marker}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planCommentUpdate(
  planCtx: JiraPlanBuildContext,
  issueKey: string,
  commentId: string,
  expectedRevision: string,
  bodyAdf: unknown,
  envelopeId: string,
): RemoteMutationPlan {
  assertSafeAdfDocument(bodyAdf, "comment.update bodyAdf");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: commentTarget(issueKey, commentId),
    action: "comment.update",
    redactedDiff: `update comment ${commentId} on ${issueKey}`,
    desiredStatePayload: { bodyAdf },
    idempotencyKey: `comment.update:${issueKey}:${commentId}:${expectedRevision}`,
    expectedRemoteRevision: expectedRevision,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planWorklogCreate(
  planCtx: JiraPlanBuildContext,
  issueKey: string,
  input: { readonly timeSpentSeconds: number; readonly comment?: unknown },
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: worklogTarget(issueKey),
    action: "worklog.create",
    redactedDiff: `log ${input.timeSpentSeconds}s of work on ${issueKey}`,
    desiredStatePayload: input,
    idempotencyKey: `worklog.create:${issueKey}:${input.timeSpentSeconds}:${Date.now()}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planAttachmentUpload(
  planCtx: JiraPlanBuildContext,
  issueKey: string,
  staged: { readonly stagingId: string; readonly filename: string; readonly sizeBytes: number },
  envelopeId: string,
): RemoteMutationPlan {
  // MEDIUM M2 (adversarial-review) defense-in-depth: `staged.filename` is
  // embedded verbatim into `redactedDiff` below, which 16 journals BEFORE
  // any network I/O. `../attachments/attachment-pipeline.ts`'s own
  // `validateFilename` already rejects a secret-shaped filename before
  // staging — this is a SECOND, independent check at the plan-build
  // boundary itself, so a caller that (incorrectly) skipped the
  // streaming-validation pipeline still cannot get a secret-shaped
  // filename into a journaled diff.
  if (containsSecretShapedContent(staged.filename)) {
    throw ConnectorError.policyBlocked({
      message: "attachment filename contains secret-shaped content — refused before journaling",
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
  const flag = unconditionalCapabilityFlagFor("attachment.upload");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: attachmentTarget(issueKey),
    action: "attachment.upload",
    // Deliberately NEVER embeds the staged file's bytes or path in the
    // plan's OWN `redactedDiff`/hash inputs beyond filename+size —
    // roadmap/18 §In scope: "bytes never enter prompts." The real
    // content lives only in `../attachments/attachment-staging.ts`'s
    // registry, keyed by `staged.stagingId`; this builder re-keys that
    // same content under the freshly-built plan's own `id` in
    // `./plan-payload-registry.ts` (see `desiredStatePayload` below) so
    // the mutation-apply client can find it at apply time without ever
    // returning it through this function's own result.
    redactedDiff: `upload attachment "${staged.filename}" (${staged.sizeBytes} bytes) to ${issueKey}`,
    desiredStatePayload: {
      stagingId: staged.stagingId,
      filename: staged.filename,
      sizeBytes: staged.sizeBytes,
    },
    idempotencyKey: `attachment.upload:${issueKey}:${staged.stagingId}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
    ...(flag !== undefined ? { requiredCapabilityFlags: [flag] } : {}),
  });
}

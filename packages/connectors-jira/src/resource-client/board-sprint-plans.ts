import type { RemoteMutationPlan } from "@eo/contracts";
import { unconditionalCapabilityFlagFor } from "../high-impact-capabilities.js";
import { boardTarget, sprintTarget } from "./canonical-target.js";
import { buildJiraMutationPlan, type JiraPlanBuildContext } from "./plan-builder.js";

export function planBoardCreate(
  planCtx: JiraPlanBuildContext,
  input: { readonly name: string; readonly type: string; readonly projectKeyOrId: string },
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: `project:${input.projectKeyOrId}:new-board`,
    action: "board.create",
    redactedDiff: `create ${input.type} board "${input.name}" in ${input.projectKeyOrId}`,
    desiredStatePayload: input,
    idempotencyKey: `board.create:${input.projectKeyOrId}:${input.name}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planBoardUpdate(
  planCtx: JiraPlanBuildContext,
  boardId: number,
  patch: { readonly name?: string },
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: boardTarget(boardId),
    action: "board.update",
    redactedDiff: `update board ${boardId} fields [${Object.keys(patch).join(", ")}]`,
    desiredStatePayload: patch,
    idempotencyKey: `board.update:${boardId}:${JSON.stringify(patch)}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planBoardRankIssues(
  planCtx: JiraPlanBuildContext,
  boardId: number,
  input: { readonly issueKeys: readonly string[]; readonly rankBeforeIssueKey?: string },
  envelopeId: string,
): RemoteMutationPlan {
  const flag = unconditionalCapabilityFlagFor("issue.rank");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: boardTarget(boardId),
    action: "issue.rank",
    redactedDiff: `rank ${input.issueKeys.length} issue(s) on board ${boardId}`,
    desiredStatePayload: input,
    idempotencyKey: `issue.rank:${boardId}:${input.issueKeys.join(",")}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
    ...(flag !== undefined ? { requiredCapabilityFlags: [flag] } : {}),
  });
}

export function planSprintCreate(
  planCtx: JiraPlanBuildContext,
  input: {
    readonly boardId: number;
    readonly name: string;
    readonly startDate?: string;
    readonly endDate?: string;
  },
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: `board:${input.boardId}:new-sprint`,
    action: "sprint.create",
    redactedDiff: `create sprint "${input.name}" on board ${input.boardId}`,
    desiredStatePayload: input,
    idempotencyKey: `sprint.create:${input.boardId}:${input.name}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planSprintStart(
  planCtx: JiraPlanBuildContext,
  sprintId: number,
  expectedRevision: string,
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: sprintTarget(sprintId),
    action: "sprint.start",
    redactedDiff: `start sprint ${sprintId}`,
    desiredStatePayload: { state: "active" },
    idempotencyKey: `sprint.start:${sprintId}:${expectedRevision}`,
    expectedRemoteRevision: expectedRevision,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

export function planSprintComplete(
  planCtx: JiraPlanBuildContext,
  sprintId: number,
  expectedRevision: string,
  envelopeId: string,
): RemoteMutationPlan {
  const flag = unconditionalCapabilityFlagFor("sprint.complete");
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: sprintTarget(sprintId),
    action: "sprint.complete",
    redactedDiff: `complete sprint ${sprintId}`,
    desiredStatePayload: { state: "closed" },
    idempotencyKey: `sprint.complete:${sprintId}:${expectedRevision}`,
    expectedRemoteRevision: expectedRevision,
    impactClass: "irreversible",
    rollbackClass: "manual-reopen",
    envelopeId,
    ...(flag !== undefined ? { requiredCapabilityFlags: [flag] } : {}),
  });
}

export function planSprintMoveIssues(
  planCtx: JiraPlanBuildContext,
  sprintId: number,
  issueKeys: readonly string[],
  envelopeId: string,
): RemoteMutationPlan {
  return buildJiraMutationPlan({
    ...planCtx,
    canonicalTarget: sprintTarget(sprintId),
    action: "sprint.moveIssues",
    redactedDiff: `move ${issueKeys.length} issue(s) into sprint ${sprintId}`,
    desiredStatePayload: { issueKeys },
    idempotencyKey: `sprint.moveIssues:${sprintId}:${issueKeys.join(",")}`,
    impactClass: "reversible",
    rollbackClass: "version-checked-restore",
    envelopeId,
  });
}

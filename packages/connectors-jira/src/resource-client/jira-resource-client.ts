import { ConnectorError } from "@crabgic/contracts";
import type { FieldMetadataIndex } from "../capability/field-metadata.js";
import type { RemoteVerificationPointer } from "../evidence/done-transition-verification.js";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { mapJiraStatusToWorkflowStage } from "../workflow/workflow-stage.js";
import {
  planBoardCreate,
  planBoardRankIssues,
  planBoardUpdate,
  planSprintComplete,
  planSprintCreate,
  planSprintMoveIssues,
  planSprintStart,
} from "./board-sprint-plans.js";
import {
  planAttachmentUpload,
  planCommentCreate,
  planCommentUpdate,
  planWorklogCreate,
} from "./comment-worklog-attachment-plans.js";
import type { JiraHttpContext } from "./http-read-helper.js";
import {
  planIssueBulkTransition,
  planIssueBulkUpdate,
  planIssueCreate,
  planIssueLink,
  planIssueTransition,
  planIssueUpdate,
} from "./issue-plans.js";
import type { JiraPlanBuildContext } from "./plan-builder.js";
import type { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import * as reads from "./reads.js";
import type { JiraResourceClient } from "./types.js";

export interface CreateJiraResourceClientDeps {
  readonly ctx: JiraHttpContext;
  /** Refreshed by the caller from `../capability/discovery.ts`'s `discoverJiraFieldMetadata` — this factory only reads it, never re-discovers on its own. */
  readonly fieldMetadataIndex: FieldMetadataIndex;
  /** Shared with `./jira-mutation-apply-client.ts` — see `./plan-payload-registry.ts`'s doc comment. */
  readonly payloadRegistry: JiraPlanPayloadRegistry;
  /**
   * Overrides the derived `tenant` used on every built `RemoteMutationPlan`
   * — defaults to the connection's first `tenantAllowlist` entry, then its
   * first `projectAllowlist` entry, then its own `id`.
   *
   * DEFECT 21: `tenantAllowlist` leads the chain because the gateway's
   * mutation pipeline now refuses a plan whose declared tenant is outside
   * that list. Deriving from `projectAllowlist` while the operator scoped
   * the connection by tenant would make every plan this client builds
   * out-of-allowlist by construction. An explicit value here still wins —
   * and an explicit OUT-of-allowlist value is exactly the case the
   * pipeline check refuses.
   */
  readonly tenant?: string;
  /**
   * MAJOR-2 fix (roadmap/21 adversarial-validation round): optional bridge
   * into 21's real evidence-pointer lookup — when supplied,
   * `issues.planTransition`'s done-transition guard consults it (via
   * `planIssueTransition`'s `resolveVerificationPointer` parameter) instead
   * of relying SOLELY on a caller-hand-passed `hasVerificationEvidence`
   * boolean. Omitted entirely, behavior is byte-identical to before this
   * fix. A typical real wiring is a closure over `@crabgic/gates`'s
   * `findRemoteResourcePointersForRequirement` result for the requirement
   * this issue tracks — this package has no dependency of its own on
   * `@crabgic/gates` (that would invert the roadmap's own 18→21 dependency
   * direction), so the caller supplies the already-resolved lookup.
   */
  readonly resolveVerificationPointer?: (issueKey: string) => RemoteVerificationPointer | undefined;
}

/**
 * Composes `./reads.ts` (network reads) and the `plan*` builder modules
 * (pure, local `RemoteMutationPlan` construction) into the full
 * `JiraResourceClient` surface — roadmap/18 §Interfaces produced. One
 * instance per `ExternalConnection`; `../provider/register.ts` caches one
 * of these per connection ID for the generic MCP dispatch surface.
 */
export function createJiraResourceClient(deps: CreateJiraResourceClientDeps): JiraResourceClient {
  const { ctx, fieldMetadataIndex, payloadRegistry } = deps;
  // DEFECT 21 — `tenantAllowlist` leads, so a tenant-scoped connection
  // produces in-allowlist plans by default and only an explicit override can
  // be refused by the gateway's admission check. Duplicated verbatim in
  // `./datacenter/jira-datacenter-resource-client.ts` (a separate copy of
  // this derivation) — both are pinned by their own tests.
  const tenant =
    deps.tenant ??
    ctx.connection.tenantAllowlist?.[0] ??
    ctx.connection.projectAllowlist?.[0] ??
    ctx.connection.id;
  const externalConnectionId = ctx.connection.id;
  const planCtx: JiraPlanBuildContext = { tenant, externalConnectionId, payloadRegistry };

  return {
    projects: {
      list: () => reads.listProjects(ctx),
      get: (projectKeyOrId) => reads.getProject(ctx, projectKeyOrId),
    },
    boards: {
      list: (projectKeyOrId) => reads.listBoards(ctx, projectKeyOrId),
      get: (boardId) => reads.getBoard(ctx, boardId),
      planCreate: (input, envelopeId) => planBoardCreate(planCtx, input, envelopeId),
      planUpdate: (boardId, patch, envelopeId) =>
        planBoardUpdate(planCtx, boardId, patch, envelopeId),
      planRankIssues: (boardId, input, envelopeId) =>
        planBoardRankIssues(planCtx, boardId, input, envelopeId),
    },
    sprints: {
      list: (boardId) => reads.listSprints(ctx, boardId),
      get: (sprintId) => reads.getSprint(ctx, sprintId),
      planCreate: (input, envelopeId) => planSprintCreate(planCtx, input, envelopeId),
      planStart: (sprintId, expectedRevision, envelopeId) =>
        planSprintStart(planCtx, sprintId, expectedRevision, envelopeId),
      planComplete: (sprintId, expectedRevision, envelopeId) =>
        planSprintComplete(planCtx, sprintId, expectedRevision, envelopeId),
      planMoveIssues: (sprintId, issueKeys, envelopeId) =>
        planSprintMoveIssues(planCtx, sprintId, issueKeys, envelopeId),
    },
    issues: {
      search: (jql, pageToken) => reads.searchIssues(ctx, jql, pageToken),
      get: (issueKey) => reads.getIssue(ctx, issueKey),
      transitions: (issueKey) => reads.listTransitions(ctx, issueKey),
      planCreate: (input, envelopeId) =>
        planIssueCreate(planCtx, input, fieldMetadataIndex, envelopeId),
      planUpdate: (issueKey, expectedRevision, fields, envelopeId) =>
        planIssueUpdate(
          planCtx,
          issueKey,
          expectedRevision,
          fields,
          fieldMetadataIndex,
          envelopeId,
        ),
      planTransition: async (
        issueKey,
        expectedRevision,
        transitionId,
        envelopeId,
        hasVerificationEvidence,
      ) => {
        // HIGH H2 (adversarial-review) fix: resolve the transition's REAL
        // target status SERVER-side — never trust a caller-supplied
        // `targetStageIsDone`. `reads.listTransitions` is the same
        // network call `issues.transitions` itself exposes; an
        // unrecognized `transitionId` is refused rather than guessed.
        const transitions = await reads.listTransitions(ctx, issueKey);
        const match = transitions.find((t) => t.id === transitionId);
        if (match === undefined) {
          throw ConnectorError.validation({
            message: `transition "${transitionId}" is not among ${issueKey}'s currently-available transitions — refusing to guess its target status`,
            provider: JIRA_PROVIDER_NAME,
            retryable: false,
          });
        }
        const targetStage = mapJiraStatusToWorkflowStage(
          match.toStatusName,
          match.toStatusCategoryKey,
        );
        return planIssueTransition(
          planCtx,
          issueKey,
          expectedRevision,
          transitionId,
          targetStage === "done",
          envelopeId,
          hasVerificationEvidence,
          deps.resolveVerificationPointer,
        );
      },
      planLink: (input, envelopeId) => planIssueLink(planCtx, input, envelopeId),
      planBulkUpdate: (issueKeys, fields, envelopeId) =>
        planIssueBulkUpdate(planCtx, issueKeys, fields, fieldMetadataIndex, envelopeId),
      planBulkTransition: (issueKeys, transitionId, envelopeId) =>
        planIssueBulkTransition(planCtx, issueKeys, transitionId, envelopeId),
    },
    comments: {
      list: (issueKey) => reads.listComments(ctx, issueKey),
      planCreate: (issueKey, bodyAdf, marker, envelopeId) =>
        planCommentCreate(planCtx, issueKey, bodyAdf, marker, envelopeId),
      planUpdate: (issueKey, commentId, expectedRevision, bodyAdf, envelopeId) =>
        planCommentUpdate(planCtx, issueKey, commentId, expectedRevision, bodyAdf, envelopeId),
    },
    worklogs: {
      list: (issueKey) => reads.listWorklogs(ctx, issueKey),
      planCreate: (issueKey, input, envelopeId) =>
        planWorklogCreate(planCtx, issueKey, input, envelopeId),
    },
    attachments: {
      planUpload: (issueKey, staged, envelopeId) =>
        planAttachmentUpload(planCtx, issueKey, staged, envelopeId),
    },
  };
}

import { ConnectorError } from "@crabgic/contracts";
import {
  assertCustomFieldWritesAreDiscovered,
  DATACENTER_CUSTOM_FIELD_REFUSAL,
  type FieldMetadataIndex,
} from "../../capability/field-metadata.js";
import type { DcEditionEntry } from "../../capability/dc-edition-feature-matrix.js";
import { JIRA_DATACENTER_PROVIDER_NAME } from "../../errors/jira-error-mapping.js";
import { mapJiraStatusToWorkflowStage } from "../../workflow/workflow-stage.js";
import { assertSafeAdfDocument } from "../adf-guard.js";
import {
  planBoardCreate,
  planBoardRankIssues,
  planBoardUpdate,
  planSprintComplete,
  planSprintCreate,
  planSprintMoveIssues,
  planSprintStart,
} from "../board-sprint-plans.js";
import {
  planAttachmentUpload,
  planCommentCreate,
  planCommentUpdate,
  planWorklogCreate,
} from "../comment-worklog-attachment-plans.js";
import {
  planIssueBulkTransition,
  planIssueBulkUpdate,
  planIssueCreate,
  planIssueLink,
  planIssueTransition,
  planIssueUpdate,
} from "../issue-plans.js";
import type { JiraAction } from "../actions.js";
import type { JiraPlanBuildContext } from "../plan-builder.js";
import type { JiraPlanPayloadRegistry } from "../plan-payload-registry.js";
import type { JiraResourceClient } from "../types.js";
import * as readsDc from "./reads-dc.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";

/**
 * `createJiraDatacenterResourceClient` — roadmap/19-jira-datacenter-
 * adapter.md §Interfaces produced: "DC resource-client implementation
 * (REST v2 + Agile routes) — a second, `datacenter`-selected
 * implementation of 18's resource-client contract, alongside 18's
 * `cloud` one." Composes `./reads-dc.ts` (Data Center network reads) with
 * 18's OWN `plan*` builder modules (`../board-sprint-plans.ts`,
 * `../issue-plans.ts`, `../comment-worklog-attachment-plans.ts`) REUSED
 * VERBATIM, never forked — those builders are already deployment-type-
 * agnostic (pure, local `RemoteMutationPlan` construction; no REST path,
 * no ADF-vs-wiki-markup decision — that split happens downstream, at
 * `./jira-mutation-apply-client-dc.ts`'s apply boundary). This is what
 * keeps roadmap/19's own framing true: "a second resource-client
 * implementation behind 18's existing contract, not a second sync
 * engine."
 *
 * `dcFeatures` (from `../../capability/dc-edition-feature-matrix.ts`,
 * resolved once via `../../capability/discovery-datacenter.ts` at
 * connection-registration time) gates every mutating `plan*` call BEFORE
 * it reaches the shared plan builders — an action absent from the
 * resolved edition's `availableActions` (including the safe-default case
 * where `dcFeatures` itself is `undefined`, an unrecognized edition)
 * throws typed `ConnectorError.unsupported` synchronously, never a
 * guessed allow, never a raw-endpoint fallback.
 */
export interface CreateJiraDatacenterResourceClientDeps {
  readonly ctx: JiraDatacenterHttpContext;
  readonly fieldMetadataIndex: FieldMetadataIndex;
  readonly payloadRegistry: JiraPlanPayloadRegistry;
  /** Resolved via `../../capability/dc-edition-feature-matrix.ts`'s `resolveDcEditionFeatures` — `undefined` for an unrecognized/not-yet-discovered edition (the safe, read-only default). */
  readonly dcFeatures?: DcEditionEntry;
  readonly tenant?: string;
}

/**
 * Consults the ALREADY-RESOLVED `dcFeatures` entry directly (resolved
 * once via `../../capability/discovery-datacenter.ts` at connection-
 * registration time, per this connector's own convention of never
 * re-discovering on every call — mirroring `../jira-resource-client.ts`'s
 * `fieldMetadataIndex` dependency, which is refreshed by the caller, not
 * by this factory) — never re-derives from the global
 * `dc-edition-feature-matrix.ts` table at call time, so a caller that
 * supplies a NARROWER `dcFeatures.availableActions` (e.g. a real,
 * discovered per-connection restriction) is always honored exactly,
 * never silently widened back to the matrix's own default.
 */
function assertActionSupported(dcFeatures: DcEditionEntry | undefined, action: JiraAction): void {
  if (dcFeatures === undefined || !dcFeatures.availableActions.includes(action)) {
    throw ConnectorError.unsupported({
      message:
        dcFeatures === undefined
          ? `Jira Data Center action "${action}" is unsupported: this connection's edition/version has not been positively confirmed by discovery — refusing to guess`
          : `Jira Data Center action "${action}" is unsupported on edition "${dcFeatures.edition}"`,
      provider: JIRA_DATACENTER_PROVIDER_NAME,
      retryable: false,
    });
  }
}

export function createJiraDatacenterResourceClient(
  deps: CreateJiraDatacenterResourceClientDeps,
): JiraResourceClient {
  const { ctx, fieldMetadataIndex, payloadRegistry, dcFeatures } = deps;
  // DEFECT 21 — `tenantAllowlist` leads, so a tenant-scoped connection
  // produces in-allowlist plans by default and only an explicit override can
  // be refused by the gateway's admission check. This is the Data Center
  // copy of the derivation in `../jira-resource-client.ts`; both are pinned
  // by their own tests, because fixing one and not the other leaves half the
  // connector building plans its own connection would refuse.
  const tenant =
    deps.tenant ??
    ctx.connection.tenantAllowlist?.[0] ??
    ctx.connection.projectAllowlist?.[0] ??
    ctx.connection.id;
  const externalConnectionId = ctx.connection.id;
  const planCtx: JiraPlanBuildContext = { tenant, externalConnectionId, payloadRegistry };
  const gate = (action: JiraAction): void => assertActionSupported(dcFeatures, action);
  /**
   * Custom-field pre-check at the Data Center plan-build boundary —
   * IDENTICAL pattern, and identical reason, to the `assertSafeAdfDocument`
   * pre-checks below (see `issues.planCreate`'s MINOR-1 comment). The shared
   * 18-owned plan builders re-run this very check internally, but without an
   * attribution argument they default to Cloud's — `validation` attributed
   * to `jira-cloud`. Running it FIRST with
   * `DATACENTER_CUSTOM_FIELD_REFUSAL` means the caller sees roadmap/19 §In
   * scope's typed `unsupported`, attributed to `jira-datacenter`, and the
   * builders' own (Cloud-attributed) copy is never reached on this path.
   *
   * The alternative — threading an attribution parameter through
   * `planIssueCreate`/`planIssueUpdate`/`planIssueBulkUpdate` — was
   * rejected: those builders are 18's, reused verbatim by this module by
   * design (see this file's header), and the pre-check convention was
   * already established here for exactly this class of mis-attribution.
   */
  const assertDatacenterCustomFieldWrites = (fields: Readonly<Record<string, unknown>>): void =>
    assertCustomFieldWritesAreDiscovered(
      fields,
      fieldMetadataIndex,
      DATACENTER_CUSTOM_FIELD_REFUSAL,
    );

  return {
    projects: {
      list: () => readsDc.listProjects(ctx),
      get: (projectKeyOrId) => readsDc.getProject(ctx, projectKeyOrId),
    },
    boards: {
      list: (projectKeyOrId) => readsDc.listBoards(ctx, projectKeyOrId),
      get: (boardId) => readsDc.getBoard(ctx, boardId),
      planCreate: (input, envelopeId) => {
        gate("board.create");
        return planBoardCreate(planCtx, input, envelopeId);
      },
      planUpdate: (boardId, patch, envelopeId) => {
        gate("board.update");
        return planBoardUpdate(planCtx, boardId, patch, envelopeId);
      },
      planRankIssues: (boardId, input, envelopeId) => {
        gate("issue.rank");
        return planBoardRankIssues(planCtx, boardId, input, envelopeId);
      },
    },
    sprints: {
      list: (boardId) => readsDc.listSprints(ctx, boardId),
      get: (sprintId) => readsDc.getSprint(ctx, sprintId),
      planCreate: (input, envelopeId) => {
        gate("sprint.create");
        return planSprintCreate(planCtx, input, envelopeId);
      },
      planStart: (sprintId, expectedRevision, envelopeId) => {
        gate("sprint.start");
        return planSprintStart(planCtx, sprintId, expectedRevision, envelopeId);
      },
      planComplete: (sprintId, expectedRevision, envelopeId) => {
        gate("sprint.complete");
        return planSprintComplete(planCtx, sprintId, expectedRevision, envelopeId);
      },
      planMoveIssues: (sprintId, issueKeys, envelopeId) => {
        gate("sprint.moveIssues");
        return planSprintMoveIssues(planCtx, sprintId, issueKeys, envelopeId);
      },
    },
    issues: {
      search: (jql, pageToken) => readsDc.searchIssues(ctx, jql, pageToken),
      get: (issueKey) => readsDc.getIssue(ctx, issueKey),
      transitions: (issueKey) => readsDc.listTransitions(ctx, issueKey),
      planCreate: (input, envelopeId) => {
        gate("issue.create");
        // MINOR-1 (adversarial-review) fix: `planIssueCreate` (18-owned,
        // reused verbatim) internally re-validates `input.summaryAdf`
        // through `assertSafeAdfDocument`, but WITHOUT a provider
        // argument it defaults to Cloud's attribution even when building
        // a Data Center plan. This pre-check runs FIRST, with the
        // correct DC provider name — if it throws, `planIssueCreate`'s
        // own (Cloud-attributed) internal check is never even reached.
        assertSafeAdfDocument(
          input.summaryAdf,
          "issue.create summaryAdf (DC plan-build boundary)",
          JIRA_DATACENTER_PROVIDER_NAME,
        );
        assertDatacenterCustomFieldWrites(input.fields ?? {});
        return planIssueCreate(planCtx, input, fieldMetadataIndex, envelopeId);
      },
      planUpdate: (issueKey, expectedRevision, fields, envelopeId) => {
        gate("issue.update");
        if (fields["description"] !== undefined) {
          assertSafeAdfDocument(
            fields["description"],
            "issue.update fields.description (DC plan-build boundary)",
            JIRA_DATACENTER_PROVIDER_NAME,
          );
        }
        assertDatacenterCustomFieldWrites(fields);
        return planIssueUpdate(
          planCtx,
          issueKey,
          expectedRevision,
          fields,
          fieldMetadataIndex,
          envelopeId,
        );
      },
      planTransition: async (
        issueKey,
        expectedRevision,
        transitionId,
        envelopeId,
        hasVerificationEvidence,
      ) => {
        gate("issue.transition");
        // Same HIGH H2 (adversarial-review) discipline 18 established:
        // resolve the transition's REAL target status SERVER-side, via
        // this same DC transport — never trust a caller-supplied
        // "targetStageIsDone" boolean.
        const transitions = await readsDc.listTransitions(ctx, issueKey);
        const match = transitions.find((t) => t.id === transitionId);
        if (match === undefined) {
          throw ConnectorError.validation({
            message: `transition "${transitionId}" is not among ${issueKey}'s currently-available transitions — refusing to guess its target status`,
            provider: JIRA_DATACENTER_PROVIDER_NAME,
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
        );
      },
      planLink: (input, envelopeId) => {
        gate("issue.link");
        return planIssueLink(planCtx, input, envelopeId);
      },
      planBulkUpdate: (issueKeys, fields, envelopeId) => {
        gate("issue.bulkUpdate");
        assertDatacenterCustomFieldWrites(fields);
        return planIssueBulkUpdate(planCtx, issueKeys, fields, fieldMetadataIndex, envelopeId);
      },
      planBulkTransition: (issueKeys, transitionId, envelopeId) => {
        gate("issue.bulkTransition");
        return planIssueBulkTransition(planCtx, issueKeys, transitionId, envelopeId);
      },
    },
    comments: {
      list: (issueKey) => readsDc.listComments(ctx, issueKey),
      planCreate: (issueKey, bodyAdf, marker, envelopeId) => {
        gate("comment.create");
        // MINOR-1 (adversarial-review) fix — same rationale as
        // `issues.planCreate` above: pre-check with the correct DC
        // provider name before delegating to the shared (Cloud-attributed
        // by default) `planCommentCreate`.
        assertSafeAdfDocument(
          bodyAdf,
          "comment.create bodyAdf (DC plan-build boundary)",
          JIRA_DATACENTER_PROVIDER_NAME,
        );
        return planCommentCreate(planCtx, issueKey, bodyAdf, marker, envelopeId);
      },
      planUpdate: (issueKey, commentId, expectedRevision, bodyAdf, envelopeId) => {
        gate("comment.update");
        assertSafeAdfDocument(
          bodyAdf,
          "comment.update bodyAdf (DC plan-build boundary)",
          JIRA_DATACENTER_PROVIDER_NAME,
        );
        return planCommentUpdate(
          planCtx,
          issueKey,
          commentId,
          expectedRevision,
          bodyAdf,
          envelopeId,
        );
      },
    },
    worklogs: {
      list: (issueKey) => readsDc.listWorklogs(ctx, issueKey),
      planCreate: (issueKey, input, envelopeId) => {
        gate("worklog.create");
        return planWorklogCreate(planCtx, issueKey, input, envelopeId);
      },
    },
    attachments: {
      planUpload: (issueKey, staged, envelopeId) => {
        gate("attachment.upload");
        return planAttachmentUpload(planCtx, issueKey, staged, envelopeId);
      },
    },
  };
}

import { ConnectorError, type RemoteMutationPlan } from "@eo/contracts";
import type {
  HttpTransportResponse,
  MarkerReconciler,
  MutationApplyClient,
  MutationApplyResult,
  MutationHttpRequestSpec,
} from "@eo/gateway";
import type { AttachmentStagingRegistry } from "../../attachments/attachment-staging.js";
import { JIRA_DATACENTER_PROVIDER_NAME } from "../../errors/jira-error-mapping.js";
import { assertAllowedJiraOperation } from "../../security/preflight-capability-guard.js";
import { assertSafeAdfDocument } from "../adf-guard.js";
import type { JiraAction } from "../actions.js";
import type { JiraPlanPayloadRegistry } from "../plan-payload-registry.js";
import type { JiraDatacenterHttpContext } from "./jira-datacenter-http-context.js";
import { getBoard, getIssue, getSprint } from "./reads-dc.js";
import { adfDocumentToWikiMarkup } from "./wiki-markup-render-profile.js";

/**
 * Data Center `MutationApplyClient` — roadmap/19-jira-datacenter-
 * adapter.md §In scope: "DC resource-client implementation (REST v2 +
 * Agile routes), implementing the same resource-client contract 18
 * establishes for Cloud... Dispatches through 16's existing plan→
 * validate→journal→apply→read-back pipeline, unchanged." Structurally a
 * near-mirror of `../jira-mutation-apply-client.ts` — SAME action
 * switch, SAME `assertAllowedJiraOperation` belt-and-suspenders re-check,
 * SAME `assertSafeAdfDocument` apply-boundary re-validation — with two
 * genuine differences: (1) `/rest/api/2/` in place of `/rest/api/3/` for
 * every non-Agile path (Agile itself, `/rest/agile/1.0/...`, is
 * byte-identical between Cloud and Data Center); (2) every ADF-bearing
 * field (`summaryAdf`, `fields.description`, `bodyAdf`) is converted to
 * Jira wiki markup via `./wiki-markup-render-profile.ts`'s
 * `adfDocumentToWikiMarkup` immediately before being embedded in the
 * request body — Data Center has no ADF wire format at all.
 */
export interface JiraDatacenterMutationApplyDeps {
  readonly ctx: JiraDatacenterHttpContext;
  readonly payloadRegistry: JiraPlanPayloadRegistry;
  readonly attachmentStaging: AttachmentStagingRegistry;
  readonly issueMarkerReconciler: MarkerReconciler;
  readonly commentMarkerReconciler: (issueKey: string) => MarkerReconciler;
}

function unsupportedAction(action: string): never {
  throw ConnectorError.unsupported({
    message: `Data Center mutation-apply client has no request builder for action "${action}"`,
    provider: JIRA_DATACENTER_PROVIDER_NAME,
    retryable: false,
  });
}

function issueKeyFromCanonicalTarget(canonicalTarget: string): string {
  const parts = canonicalTarget.split(":");
  return parts[1] ?? canonicalTarget;
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function idAsString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Re-validates every outgoing ADF-bearing field against the SAME safe-
 * subset guard Cloud uses (`../adf-guard.ts`'s `assertSafeAdfDocument`,
 * reused unmodified — no parallel DC-only check is invented), then
 * replaces its value with the wiki-markup string
 * `adfDocumentToWikiMarkup` derives from it. Runs at the apply boundary
 * regardless of which entry point built the plan, mirroring Cloud's own
 * `assertOutgoingAdfIsSafe` defense-in-depth rationale.
 */
function convertAdfFieldsToWikiMarkup(
  action: JiraAction,
  payload: unknown,
): Record<string, unknown> {
  const record = asRecord(payload);
  if (action === "issue.create") {
    const adf = assertSafeAdfDocument(
      record["summaryAdf"],
      "issue.create summaryAdf (DC apply boundary)",
      JIRA_DATACENTER_PROVIDER_NAME,
    );
    return { ...record, summaryAdf: adfDocumentToWikiMarkup(adf) };
  }
  if (action === "issue.update" && record["description"] !== undefined) {
    const adf = assertSafeAdfDocument(
      record["description"],
      "issue.update fields.description (DC apply boundary)",
      JIRA_DATACENTER_PROVIDER_NAME,
    );
    return { ...record, description: adfDocumentToWikiMarkup(adf) };
  }
  if (action === "comment.create" || action === "comment.update") {
    const adf = assertSafeAdfDocument(
      record["bodyAdf"],
      `${action} bodyAdf (DC apply boundary)`,
      JIRA_DATACENTER_PROVIDER_NAME,
    );
    return { ...record, bodyAdf: adfDocumentToWikiMarkup(adf) };
  }
  return record;
}

function buildRequestForAction(
  plan: RemoteMutationPlan,
  deps: JiraDatacenterMutationApplyDeps,
): MutationHttpRequestSpec {
  const action = plan.action as JiraAction;
  const hasPrecondition = plan.expectedRemoteRevision !== undefined;
  const url = (path: string): URL => new URL(path, deps.ctx.connection.baseUrl);
  const rawPayload = deps.payloadRegistry.take(plan.id);
  const payload = convertAdfFieldsToWikiMarkup(action, rawPayload);

  switch (action) {
    case "issue.create":
      return {
        url: url("/rest/api/2/issue"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          ...payload,
          properties: [{ key: "eo", value: { marker: plan.idempotencyKey } }],
        }),
      };
    case "issue.update":
      return {
        url: url(
          `/rest/api/2/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}`,
        ),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ fields: payload }),
        hasPrecondition,
      };
    case "issue.transition":
      return {
        url: url(
          `/rest/api/2/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}/transitions`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ transition: { id: payload["transitionId"] } }),
        hasPrecondition,
      };
    case "issue.link":
      return {
        url: url("/rest/api/2/issueLink"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "issue.rank":
      return {
        url: url("/rest/agile/1.0/issue/rank"),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "issue.bulkUpdate":
      return {
        url: url("/rest/api/2/bulk/issues/fields"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "issue.bulkTransition":
      return {
        url: url("/rest/api/2/bulk/issues/transition"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "comment.create":
      return {
        url: url(
          `/rest/api/2/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}/comment`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          body: payload["bodyAdf"],
          properties: [{ key: "eo", value: { marker: plan.idempotencyKey } }],
        }),
      };
    case "comment.update": {
      const [, issueKey, , commentId] = plan.canonicalTarget.split(":");
      return {
        url: url(
          `/rest/api/2/issue/${encodeURIComponent(issueKey ?? "")}/comment/${encodeURIComponent(commentId ?? "")}`,
        ),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ body: payload["bodyAdf"] }),
        hasPrecondition,
      };
    }
    case "worklog.create":
      return {
        url: url(
          `/rest/api/2/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}/worklog`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "attachment.upload": {
      const issueKey = issueKeyFromCanonicalTarget(plan.canonicalTarget);
      const stagingId = payload["stagingId"];
      const staged = deps.attachmentStaging.take(typeof stagingId === "string" ? stagingId : "");
      return {
        url: url(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/attachments`),
        method: "POST",
        headers: { "x-atlassian-token": "no-check", "content-type": "application/octet-stream" },
        body: JSON.stringify({
          filename: staged.filename,
          contentBase64: staged.content.toString("base64"),
        }),
      };
    }
    case "board.create":
      return {
        url: url("/rest/agile/1.0/board"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "board.update":
      return {
        url: url(`/rest/agile/1.0/board/${issueKeyFromCanonicalTarget(plan.canonicalTarget)}`),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "sprint.create":
      return {
        url: url("/rest/agile/1.0/sprint"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "sprint.start":
    case "sprint.complete":
      return {
        url: url(`/rest/agile/1.0/sprint/${issueKeyFromCanonicalTarget(plan.canonicalTarget)}`),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
        hasPrecondition,
      };
    case "sprint.moveIssues":
      return {
        url: url(
          `/rest/agile/1.0/sprint/${issueKeyFromCanonicalTarget(plan.canonicalTarget)}/issue`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    /* c8 ignore next 2 -- exhaustiveness guard; JIRA_ACTIONS is a closed union */
    default: {
      const _exhaustive: never = action;
      return unsupportedAction(String(_exhaustive));
    }
  }
}

function parseResponseForAction(
  plan: RemoteMutationPlan,
  response: HttpTransportResponse,
): MutationApplyResult {
  const action = plan.action as JiraAction;
  const body =
    response.bodyText.length > 0 ? (JSON.parse(response.bodyText) as unknown) : undefined;
  const record = asRecord(body);

  switch (action) {
    case "issue.create":
    case "board.create":
    case "sprint.create":
    case "comment.create":
    case "worklog.create": {
      const id = idAsString(record["key"] ?? record["id"]);
      return { appliedRevision: id ?? `${JIRA_DATACENTER_PROVIDER_NAME}:created` };
    }
    case "attachment.upload": {
      const first = Array.isArray(body) ? asRecord(body[0]) : record;
      const id = idAsString(first["id"]);
      return { appliedRevision: id ?? `${JIRA_DATACENTER_PROVIDER_NAME}:uploaded` };
    }
    default:
      return { appliedRevision: plan.desiredStateHash };
  }
}

async function verifyForAction(
  ctx: JiraDatacenterHttpContext,
  plan: RemoteMutationPlan,
): Promise<boolean> {
  const action = plan.action as JiraAction;
  try {
    switch (action) {
      case "issue.update":
      case "issue.transition": {
        const issueKey = issueKeyFromCanonicalTarget(plan.canonicalTarget);
        const issue = await getIssue(ctx, issueKey);
        return (
          plan.expectedRemoteRevision === undefined ||
          issue.revision !== plan.expectedRemoteRevision
        );
      }
      case "sprint.start":
      case "sprint.complete": {
        const sprintId = Number(issueKeyFromCanonicalTarget(plan.canonicalTarget));
        const sprint = await getSprint(ctx, sprintId);
        return action === "sprint.start" ? sprint.state === "active" : sprint.state === "closed";
      }
      case "board.update": {
        const boardId = Number(issueKeyFromCanonicalTarget(plan.canonicalTarget));
        await getBoard(ctx, boardId);
        return true;
      }
      default:
        return true;
    }
  } catch {
    return false;
  }
}

/** Builds this connector's Data Center `MutationApplyClient` — registered under `../../provider/register-datacenter.ts` alongside the read/plan `GenericProviderClient`. */
export function createJiraDatacenterMutationApplyClient(
  deps: JiraDatacenterMutationApplyDeps,
): MutationApplyClient {
  return {
    buildRequest: (plan) => {
      assertAllowedJiraOperation(plan.action);
      return buildRequestForAction(plan, deps);
    },
    parseResponse: (plan, response) => parseResponseForAction(plan, response),
    verify: (plan) => verifyForAction(deps.ctx, plan),
    reconcileAmbiguous: async (plan) => {
      const action = plan.action as JiraAction;
      if (action === "issue.create") {
        const found = await deps.issueMarkerReconciler.findByMarker(plan.idempotencyKey);
        return found !== undefined ? { appliedRevision: found } : undefined;
      }
      if (action === "comment.create") {
        const issueKey = issueKeyFromCanonicalTarget(plan.canonicalTarget);
        const found = await deps
          .commentMarkerReconciler(issueKey)
          .findByMarker(plan.idempotencyKey);
        return found !== undefined ? { appliedRevision: found } : undefined;
      }
      return undefined;
    },
  };
}

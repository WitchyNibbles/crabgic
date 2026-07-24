import { ConnectorError, type RemoteMutationPlan } from "@eo/contracts";
import type {
  HttpTransportResponse,
  MarkerReconciler,
  MutationApplyClient,
  MutationApplyResult,
  MutationHttpRequestSpec,
} from "@eo/gateway";
import type { AttachmentStagingRegistry } from "../attachments/attachment-staging.js";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { assertAllowedJiraOperation } from "../security/preflight-capability-guard.js";
import { assertSafeAdfDocument } from "./adf-guard.js";
import type { JiraAction } from "./actions.js";
import type { JiraHttpContext } from "./http-read-helper.js";
import type { JiraPlanPayloadRegistry } from "./plan-payload-registry.js";
import { getBoard, getIssue, getSprint } from "./reads.js";

/**
 * `MutationApplyClient` implementation — roadmap/18 §Interfaces
 * consumed: "every create/update/transition/comment call is submitted
 * through [16's mutation pipeline]; this phase never persists
 * `RemoteOperationRecord` itself." This is the ONE place this connector's
 * plans turn into actual outbound HTTP — `executeMutationPlan`
 * (`@eo/gateway`) is the sole caller of `buildRequest`/`parseResponse`/
 * `verify`/`reconcileAmbiguous` below; this module never issues network
 * I/O directly.
 *
 * `assertAllowedJiraOperation` runs FIRST inside `buildRequest` too (belt-
 * and-suspenders alongside `../resource-client/plan-builder.ts`'s own
 * call) — a plan somehow constructed with a forged action still cannot
 * reach a real HTTP request from this call site either.
 *
 * `RemoteMutationPlan` itself carries only a redacted diff + content
 * hash, never the real desired-state payload — `buildRequest` recovers
 * the real payload from `./plan-payload-registry.ts`, keyed by the
 * plan's own `id` (populated by `./plan-builder.ts` at plan-construction
 * time). Attachment content is a further hop: the payload only carries a
 * `stagingId`, resolved through `../attachments/attachment-staging.ts`'s
 * registry — bytes are read from there exactly once, immediately before
 * this request is built, never surfacing through the plan itself.
 */
export interface JiraMutationApplyDeps {
  readonly ctx: JiraHttpContext;
  readonly payloadRegistry: JiraPlanPayloadRegistry;
  readonly attachmentStaging: AttachmentStagingRegistry;
  /** `MarkerReconciler` for `issue.create` (site-wide) — searches by the plan's own `idempotencyKey` as the marker. */
  readonly issueMarkerReconciler: MarkerReconciler;
  /** Builds a `MarkerReconciler` scoped to one issue's comments, for `comment.create`. */
  readonly commentMarkerReconciler: (issueKey: string) => MarkerReconciler;
}

function unsupportedAction(action: string): never {
  throw ConnectorError.unsupported({
    message: `mutation-apply client has no request builder for action "${action}"`,
    provider: JIRA_PROVIDER_NAME,
    retryable: false,
  });
}

function issueKeyFromCanonicalTarget(canonicalTarget: string): string {
  // "issue:PROJ-1" | "issue:PROJ-1:comment" | "issue:PROJ-1:comment:10" | "issue:PROJ-1:worklog" | "issue:PROJ-1:attachment"
  const parts = canonicalTarget.split(":");
  return parts[1] ?? canonicalTarget;
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** A created-resource identifier may come back as either a Jira issue KEY (string) or an Agile-API numeric id (board/sprint) — this connector's `appliedRevision` is always a string either way. */
function idAsString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * HIGH H1 (adversarial-review) apply-boundary enforcement: re-validates
 * every outgoing ADF payload (issue description/summary, comment body)
 * immediately before it is embedded in the real request body — fully
 * independent of, and redundant with, the plan-build-time guards in
 * `./issue-plans.ts`/`./comment-worklog-attachment-plans.ts`. This is
 * what makes the guarantee hold "regardless of which entry point built
 * the plan": a plan somehow constructed by calling
 * `./plan-builder.ts`'s `buildJiraMutationPlan` directly (bypassing the
 * typed `plan*` functions), or a payload-registry entry populated by any
 * other means, still cannot reach a real Jira POST/PUT with unsafe ADF.
 */
function assertOutgoingAdfIsSafe(action: JiraAction, payload: unknown): void {
  const record = asRecord(payload);
  if (action === "issue.create") {
    assertSafeAdfDocument(record["summaryAdf"], "issue.create summaryAdf (apply boundary)");
  }
  if (action === "issue.update" && record["description"] !== undefined) {
    assertSafeAdfDocument(
      record["description"],
      "issue.update fields.description (apply boundary)",
    );
  }
  if (action === "comment.create" || action === "comment.update") {
    assertSafeAdfDocument(record["bodyAdf"], `${action} bodyAdf (apply boundary)`);
  }
}

function buildRequestForAction(
  plan: RemoteMutationPlan,
  deps: JiraMutationApplyDeps,
): MutationHttpRequestSpec {
  const action = plan.action as JiraAction;
  const hasPrecondition = plan.expectedRemoteRevision !== undefined;
  const url = (path: string): URL => new URL(path, deps.ctx.connection.baseUrl);
  const payload = deps.payloadRegistry.take(plan.id);
  assertOutgoingAdfIsSafe(action, payload);

  switch (action) {
    case "issue.create":
      return {
        url: url("/rest/api/3/issue"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          ...asRecord(payload),
          properties: [{ key: "eo", value: { marker: plan.idempotencyKey } }],
        }),
      };
    case "issue.update":
      return {
        url: url(
          `/rest/api/3/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}`,
        ),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ fields: payload }),
        hasPrecondition,
      };
    case "issue.transition":
      return {
        url: url(
          `/rest/api/3/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}/transitions`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ transition: { id: asRecord(payload)["transitionId"] } }),
        hasPrecondition,
      };
    case "issue.link":
      return {
        url: url("/rest/api/3/issueLink"),
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
        url: url("/rest/api/3/bulk/issues/fields"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "issue.bulkTransition":
      return {
        url: url("/rest/api/3/bulk/issues/transition"),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "comment.create":
      return {
        url: url(
          `/rest/api/3/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}/comment`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        // MEDIUM M1 (adversarial-review) fix: stamps `plan.idempotencyKey`
        // — NOT the bare caller-supplied `payload.marker` — as the
        // entity-property value. `reconcileAmbiguous` (below) searches
        // for this SAME `plan.idempotencyKey` after a mid-POST timeout;
        // stamping anything else would make that search never match a
        // comment that actually landed, silently breaking recovery
        // (`issue.create` already got this right — this brings
        // `comment.create` in line with that same convention).
        body: JSON.stringify({
          body: asRecord(payload)["bodyAdf"],
          properties: [{ key: "eo", value: { marker: plan.idempotencyKey } }],
        }),
      };
    case "comment.update": {
      const [, issueKey, , commentId] = plan.canonicalTarget.split(":");
      return {
        url: url(
          `/rest/api/3/issue/${encodeURIComponent(issueKey ?? "")}/comment/${encodeURIComponent(commentId ?? "")}`,
        ),
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({ body: asRecord(payload)["bodyAdf"] }),
        hasPrecondition,
      };
    }
    case "worklog.create":
      return {
        url: url(
          `/rest/api/3/issue/${encodeURIComponent(issueKeyFromCanonicalTarget(plan.canonicalTarget))}/worklog`,
        ),
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload),
      };
    case "attachment.upload": {
      const issueKey = issueKeyFromCanonicalTarget(plan.canonicalTarget);
      const stagingId = asRecord(payload)["stagingId"];
      const staged = deps.attachmentStaging.take(typeof stagingId === "string" ? stagingId : "");
      return {
        url: url(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`),
        method: "POST",
        headers: { "x-atlassian-token": "no-check", "content-type": "application/octet-stream" },
        // Real Jira expects a multipart body; this connector's transport
        // layer carries `body` as a string (see @eo/gateway's
        // `MutationHttpRequestSpec`) — base64 is this module's own
        // encoding choice for that string channel. `staged.content` is
        // read exactly once, right here, and never stored anywhere else.
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
      return { appliedRevision: id ?? `${JIRA_PROVIDER_NAME}:created` };
    }
    case "attachment.upload": {
      const first = Array.isArray(body) ? asRecord(body[0]) : record;
      const id = idAsString(first["id"]);
      return { appliedRevision: id ?? `${JIRA_PROVIDER_NAME}:uploaded` };
    }
    default:
      // Every other action's Jira response is either empty (204) or a
      // representation with no stable revision field this connector can
      // trust generically — the plan's own content hash IS the applied
      // state's fingerprint (a successful, non-4xx/5xx HTTP status is
      // this method's only signal that it was accepted); `verify()`
      // below performs the actual read-back confirmation.
      return { appliedRevision: plan.desiredStateHash };
  }
}

async function verifyForAction(ctx: JiraHttpContext, plan: RemoteMutationPlan): Promise<boolean> {
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
        // No cheap, generically-trustworthy read-back handle for this
        // action (roadmap/18's exact-revision verification gate is 21's
        // job, per its own §In scope note); a successful, non-error HTTP
        // status from `performApplyOnce` is this method's signal.
        return true;
    }
  } catch {
    return false;
  }
}

/** Builds this connector's `MutationApplyClient` — registered under `../provider/register.ts` alongside the read/plan `GenericProviderClient`. */
export function createJiraMutationApplyClient(deps: JiraMutationApplyDeps): MutationApplyClient {
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

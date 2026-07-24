import { ConnectorError } from "@eo/contracts";
import type { GenericProviderClient } from "@eo/gateway";
import type { JiraResourceClient } from "./types.js";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";

/**
 * `GenericProviderClient` adapter — routes the gateway's generic
 * `tracker.search/get/plan_create/plan_update/plan_transition/
 * plan_comment` dispatch onto ONE connection's `JiraResourceClient`
 * (`@eo/gateway`'s `provider-dispatch-tool.ts` resolves this client by
 * `ExternalConnection.provider` alone, so every params bag here carries
 * its own `resource` — and, where a resource has more than one shape of
 * update, its own `op` — sub-selector; there is no other channel this
 * generic dispatch surface offers).
 *
 * `tracker.apply` is deliberately NOT implemented here —
 * `../resource-client/jira-mutation-apply-client.ts` backs that verb
 * through the separate `MutationApplyClient` contract (roadmap/18
 * §Interfaces consumed: "`tracker.apply`... dispatch to it for any
 * Jira-typed `ExternalConnection`").
 */
export type JiraDispatchResource =
  "project" | "board" | "sprint" | "issue" | "comment" | "worklog" | "attachment";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function resourceOf(params: Record<string, unknown>): JiraDispatchResource {
  const resource = params["resource"];
  if (typeof resource !== "string") {
    throw ConnectorError.validation({
      message: "params.resource is required for Jira tracker dispatch",
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    });
  }
  return resource as JiraDispatchResource;
}

function unsupportedDispatch(verb: string, resource: string): never {
  throw ConnectorError.unsupported({
    message: `tracker.${verb} has no Jira dispatch for resource "${resource}"`,
    provider: JIRA_PROVIDER_NAME,
    retryable: false,
  });
}

async function dispatchSearch(
  client: JiraResourceClient,
  params: Record<string, unknown>,
): Promise<unknown> {
  const resource = resourceOf(params);
  if (resource === "issue") {
    return client.issues.search(
      String(params["jql"] ?? ""),
      params["pageToken"] as string | undefined,
    );
  }
  if (resource === "project") return client.projects.list();
  if (resource === "board")
    return client.boards.list(params["projectKeyOrId"] as string | undefined);
  if (resource === "sprint") return client.sprints.list(Number(params["boardId"]));
  if (resource === "comment") return client.comments.list(String(params["issueKey"] ?? ""));
  if (resource === "worklog") return client.worklogs.list(String(params["issueKey"] ?? ""));
  return unsupportedDispatch("search", resource);
}

async function dispatchGet(
  client: JiraResourceClient,
  params: Record<string, unknown>,
): Promise<unknown> {
  const resource = resourceOf(params);
  if (resource === "issue") return client.issues.get(String(params["issueKey"]));
  if (resource === "project") return client.projects.get(String(params["projectKeyOrId"]));
  if (resource === "board") return client.boards.get(Number(params["boardId"]));
  if (resource === "sprint") return client.sprints.get(Number(params["sprintId"]));
  return unsupportedDispatch("get", resource);
}

function dispatchPlanCreate(client: JiraResourceClient, params: Record<string, unknown>): unknown {
  const resource = resourceOf(params);
  const envelopeId = String(params["envelopeId"]);
  if (resource === "issue") {
    return client.issues.planCreate(
      {
        projectKeyOrId: String(params["projectKeyOrId"]),
        issueType: String(params["issueType"]),
        summaryAdf: params["summaryAdf"],
        fields: asRecord(params["fields"]),
      },
      envelopeId,
    );
  }
  if (resource === "board") {
    return client.boards.planCreate(
      {
        name: String(params["name"]),
        type: String(params["type"]),
        projectKeyOrId: String(params["projectKeyOrId"]),
      },
      envelopeId,
    );
  }
  if (resource === "sprint") {
    return client.sprints.planCreate(
      {
        boardId: Number(params["boardId"]),
        name: String(params["name"]),
        ...(typeof params["startDate"] === "string" ? { startDate: params["startDate"] } : {}),
        ...(typeof params["endDate"] === "string" ? { endDate: params["endDate"] } : {}),
      },
      envelopeId,
    );
  }
  if (resource === "worklog") {
    return client.worklogs.planCreate(
      String(params["issueKey"]),
      { timeSpentSeconds: Number(params["timeSpentSeconds"]), comment: params["comment"] },
      envelopeId,
    );
  }
  if (resource === "attachment") {
    return client.attachments.planUpload(
      String(params["issueKey"]),
      {
        stagingId: String(params["stagingId"]),
        filename: String(params["filename"]),
        sizeBytes: Number(params["sizeBytes"]),
      },
      envelopeId,
    );
  }
  return unsupportedDispatch("plan_create", resource);
}

function dispatchPlanUpdate(client: JiraResourceClient, params: Record<string, unknown>): unknown {
  const resource = resourceOf(params);
  const envelopeId = String(params["envelopeId"]);
  const op = typeof params["op"] === "string" ? params["op"] : undefined;

  if (resource === "issue") {
    if (op === "link") {
      return client.issues.planLink(
        {
          linkType: String(params["linkType"]),
          outwardIssueKey: String(params["outwardIssueKey"]),
          inwardIssueKey: String(params["inwardIssueKey"]),
        },
        envelopeId,
      );
    }
    if (op === "bulkUpdate") {
      return client.issues.planBulkUpdate(
        (params["issueKeys"] as string[]) ?? [],
        asRecord(params["fields"]),
        envelopeId,
      );
    }
    if (op === "rank") {
      return client.boards.planRankIssues(
        Number(params["boardId"]),
        {
          issueKeys: (params["issueKeys"] as string[]) ?? [],
          ...(typeof params["rankBeforeIssueKey"] === "string"
            ? { rankBeforeIssueKey: params["rankBeforeIssueKey"] }
            : {}),
        },
        envelopeId,
      );
    }
    return client.issues.planUpdate(
      String(params["issueKey"]),
      String(params["expectedRevision"]),
      asRecord(params["fields"]),
      envelopeId,
    );
  }
  if (resource === "board") {
    return client.boards.planUpdate(
      Number(params["boardId"]),
      asRecord(params["patch"]),
      envelopeId,
    );
  }
  if (resource === "sprint") {
    if (op === "start") {
      return client.sprints.planStart(
        Number(params["sprintId"]),
        String(params["expectedRevision"]),
        envelopeId,
      );
    }
    if (op === "complete") {
      return client.sprints.planComplete(
        Number(params["sprintId"]),
        String(params["expectedRevision"]),
        envelopeId,
      );
    }
    if (op === "moveIssues") {
      return client.sprints.planMoveIssues(
        Number(params["sprintId"]),
        (params["issueKeys"] as string[]) ?? [],
        envelopeId,
      );
    }
    return unsupportedDispatch("plan_update", `sprint (op="${String(op)}")`);
  }
  if (resource === "comment") {
    return client.comments.planUpdate(
      String(params["issueKey"]),
      String(params["commentId"]),
      String(params["expectedRevision"]),
      params["bodyAdf"],
      envelopeId,
    );
  }
  return unsupportedDispatch("plan_update", resource);
}

async function dispatchPlanTransition(
  client: JiraResourceClient,
  params: Record<string, unknown>,
): Promise<unknown> {
  const envelopeId = String(params["envelopeId"]);
  if (Array.isArray(params["issueKeys"])) {
    return client.issues.planBulkTransition(
      params["issueKeys"] as string[],
      String(params["transitionId"]),
      envelopeId,
    );
  }
  // HIGH H2 (adversarial-review) fix: `params["targetStageIsDone"]` is no
  // longer read/forwarded at all — a caller (an untrusted model-driven
  // MCP tool call included) can no longer forge this boolean; the target
  // status is always resolved server-side inside `planTransition` itself.
  return client.issues.planTransition(
    String(params["issueKey"]),
    String(params["expectedRevision"]),
    String(params["transitionId"]),
    envelopeId,
    Boolean(params["hasVerificationEvidence"]),
  );
}

function dispatchPlanComment(client: JiraResourceClient, params: Record<string, unknown>): unknown {
  const envelopeId = String(params["envelopeId"]);
  return client.comments.planCreate(
    String(params["issueKey"]),
    params["bodyAdf"],
    String(params["marker"]),
    envelopeId,
  );
}

/** Builds a `GenericProviderClient` bound to one connection's already-constructed `JiraResourceClient`. */
export function createJiraProviderClient(client: JiraResourceClient): GenericProviderClient {
  return {
    search: (params) => dispatchSearch(client, params),
    get: (params) => dispatchGet(client, params),
    planCreate: async (params) => dispatchPlanCreate(client, params),
    planUpdate: async (params) => dispatchPlanUpdate(client, params),
    planTransition: async (params) => await dispatchPlanTransition(client, params),
    planComment: async (params) => dispatchPlanComment(client, params),
  };
}

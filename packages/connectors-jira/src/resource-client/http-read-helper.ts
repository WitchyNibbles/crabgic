import { ConnectorError, type ExternalConnection } from "@eo/contracts";
import type { GatewayHttpClient } from "@eo/gateway";
import type { z } from "zod";
import {
  JIRA_PROVIDER_NAME,
  mapJiraStatusToConnectorErrorKind,
} from "../errors/jira-error-mapping.js";
import type { JiraTokenManager } from "../auth/token-manager.js";

/** Shared context every `JiraResourceClient` read/apply builder closes over — one instance per `ExternalConnection`. */
export interface JiraHttpContext {
  readonly connection: ExternalConnection;
  readonly httpClient: GatewayHttpClient;
  readonly tokenManager: JiraTokenManager;
}

function safeParseJson(text: string): unknown {
  try {
    return text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return undefined;
  }
}

/**
 * Performs one authenticated GET, mapping any HTTP failure to exactly one
 * canonical `ConnectorError`, then validates the parsed body against
 * `schema` — roadmap/18 RULES: "Validate all external API responses at
 * the boundary." A malformed/unexpected shape is a `validation`-kind
 * error, never a silently-coerced partial object.
 *
 * The access token is acquired FIRST, via `ctx.tokenManager` — an
 * expired/unrefreshable token throws before this function ever
 * constructs a request (roadmap/18 work item 1 entry point).
 */
export async function jiraGetJson<T>(
  ctx: JiraHttpContext,
  path: string,
  schema: z.ZodType<T>,
  resourceLabel: string,
): Promise<T> {
  const token = await ctx.tokenManager.getAccessToken();

  const response = await ctx.httpClient.request({
    connectionId: ctx.connection.id,
    tenant: ctx.connection.id,
    resource: resourceLabel,
    url: new URL(path, ctx.connection.baseUrl),
    method: "GET",
    headers: { authorization: `Bearer ${token.accessToken}`, accept: "application/json" },
  });

  const parsedBody = safeParseJson(response.bodyText);

  if (response.status >= 400) {
    throw mapJiraStatusToConnectorErrorKind(response.status, parsedBody);
  }

  const result = schema.safeParse(parsedBody);
  if (!result.success) {
    throw ConnectorError.validation({
      message: `Jira response for "${resourceLabel}" failed boundary validation`,
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
      rawProviderResponse: result.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  return result.data;
}

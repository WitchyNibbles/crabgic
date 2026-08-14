import { ConnectorError, type ExternalConnection } from "@crabgic/contracts";
import type { GatewayHttpClient } from "@crabgic/gateway";
import type { z } from "zod";
import {
  JIRA_PROVIDER_NAME,
  mapJiraStatusToConnectorErrorKind,
} from "../errors/jira-error-mapping.js";
import type { JiraTokenManager } from "../auth/token-manager.js";
import type { JiraAuthHeaderProvider } from "../auth/jira-datacenter-auth.js";

/** Shared context every `JiraResourceClient` read/apply builder closes over — one instance per `ExternalConnection`. */
export interface JiraHttpContext {
  readonly connection: ExternalConnection;
  readonly httpClient: GatewayHttpClient;
  readonly tokenManager: JiraTokenManager;
  /**
   * The connection's resolved authorization scheme. Supplied by
   * `../provider/jira-connection-registry.ts` in production, from the
   * connection's own `JiraConnectionConfig`.
   *
   * OPTIONAL for one reason only: this context has ~37 construction sites
   * across fixtures and tests that predate a configurable scheme and mean
   * "OAuth Bearer", which is exactly what omitting it still gives. It is
   * NOT an alternative code path — `jiraAuthHeader` below is the single
   * place either shape becomes a header, so there is one answer to "how
   * does a Jira request authenticate", not two.
   */
  readonly authHeaderProvider?: JiraAuthHeaderProvider;
}

/**
 * The ONE place a Jira Cloud request's authorization header is decided.
 *
 * It used to be a hardcoded `Bearer ${token.accessToken}` at the single
 * call site below, which silently made OAuth the only expressible Cloud
 * credential — and Atlassian rejects API tokens sent as Bearer, so the
 * credential operators actually hold could not be used at all (issue
 * #135). Routing both shapes through one function keeps that from
 * becoming two divergent auth paths.
 */
async function jiraAuthHeader(ctx: JiraHttpContext): Promise<Record<string, string>> {
  if (ctx.authHeaderProvider !== undefined) return { ...(await ctx.authHeaderProvider()) };
  const token = await ctx.tokenManager.getAccessToken();
  return { authorization: `Bearer ${token.accessToken}` };
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
  const authorization = await jiraAuthHeader(ctx);

  const response = await ctx.httpClient.request({
    connectionId: ctx.connection.id,
    tenant: ctx.connection.id,
    resource: resourceLabel,
    url: new URL(path, ctx.connection.baseUrl),
    method: "GET",
    headers: { ...authorization, accept: "application/json" },
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

import { ConnectorError, type ExternalConnection } from "@eo/contracts";
import type { GatewayHttpClient } from "@eo/gateway";
import type { z } from "zod";
import { JIRA_DATACENTER_PROVIDER_NAME } from "../../errors/jira-error-mapping.js";
import { mapJiraDatacenterStatusToConnectorErrorKind } from "../../errors/jira-error-mapping.js";
import type { JiraAuthHeaderProvider } from "../../auth/jira-datacenter-auth.js";

/**
 * Data Center equivalent of `../http-read-helper.ts`'s `JiraHttpContext`/
 * `jiraGetJson` — roadmap/19-jira-datacenter-adapter.md §In scope: "REST
 * v2 + Agile routes, implementing the same resource-client contract 18
 * establishes for Cloud." The one structural difference from Cloud's
 * context: `authHeaderProvider` (not a `JiraTokenManager`) — Data Center's
 * PAT auth uses the same `Bearer` scheme Cloud's OAuth does, but its
 * opt-in Basic-auth mode does not, so this context is built against the
 * narrower async-header-builder abstraction
 * (`../../auth/jira-datacenter-auth.ts`) that covers both.
 */
export interface JiraDatacenterHttpContext {
  readonly connection: ExternalConnection;
  readonly httpClient: GatewayHttpClient;
  readonly authHeaderProvider: JiraAuthHeaderProvider;
}

function safeParseJson(text: string): unknown {
  try {
    return text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return undefined;
  }
}

/**
 * Performs one authenticated GET against a Data Center connection,
 * mapping any HTTP failure to exactly one canonical `ConnectorError`
 * (attributed to `JIRA_DATACENTER_PROVIDER_NAME`, never `"jira-cloud"`),
 * then validates the parsed body against `schema` — identical boundary-
 * validation discipline to `../http-read-helper.ts`'s `jiraGetJson`.
 */
export async function jiraDatacenterGetJson<T>(
  ctx: JiraDatacenterHttpContext,
  path: string,
  schema: z.ZodType<T>,
  resourceLabel: string,
): Promise<T> {
  const authHeaders = await ctx.authHeaderProvider();

  const response = await ctx.httpClient.request({
    connectionId: ctx.connection.id,
    tenant: ctx.connection.id,
    resource: resourceLabel,
    url: new URL(path, ctx.connection.baseUrl),
    method: "GET",
    headers: { ...authHeaders, accept: "application/json" },
  });

  const parsedBody = safeParseJson(response.bodyText);

  if (response.status >= 400) {
    throw mapJiraDatacenterStatusToConnectorErrorKind(response.status, parsedBody);
  }

  const result = schema.safeParse(parsedBody);
  if (!result.success) {
    throw ConnectorError.validation({
      message: `Jira Data Center response for "${resourceLabel}" failed boundary validation`,
      provider: JIRA_DATACENTER_PROVIDER_NAME,
      retryable: false,
      rawProviderResponse: result.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  return result.data;
}

import type { SecretReference } from "@eo/contracts";
import { type GatewayHttpClient, resolveSecretReference } from "@eo/gateway";
import type { FetchJiraOAuthToken, JiraOAuthTokenResponse } from "./token-manager.js";

/**
 * Production wiring for `JiraTokenManager`'s `fetchToken` — resolves the
 * service-account client id/secret via `@eo/gateway`'s secret-reference
 * resolver (never a literal credential held anywhere in this module's own
 * state — resolved fresh on every call, used once, discarded) and POSTs
 * the OAuth 2.0 client-credentials grant through the SUPPLIED
 * `GatewayHttpClient` (the caller wires this to the SSRF-guarded transport
 * stack — this module performs no transport of its own).
 */
export interface JiraOAuthClientCredentials {
  readonly clientId: SecretReference;
  readonly clientSecret: SecretReference;
  /** The Atlassian OAuth audience — default `api.atlassian.com` (Jira Cloud's own default). */
  readonly audience?: string;
  readonly scopes: readonly string[];
}

export interface JiraOAuthHttpOptions {
  /** Default `https://auth.atlassian.com/oauth/token`. */
  readonly tokenUrl?: string;
}

const DEFAULT_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const DEFAULT_AUDIENCE = "api.atlassian.com";

interface RawTokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly scope?: unknown;
}

function parseTokenResponseBody(bodyText: string): RawTokenResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error("Jira OAuth token endpoint returned a malformed JSON body");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Jira OAuth token endpoint returned a non-object JSON body");
  }
  return parsed as RawTokenResponse;
}

function toTokenResponse(raw: RawTokenResponse): JiraOAuthTokenResponse {
  if (typeof raw.access_token !== "string" || raw.access_token.length === 0) {
    throw new Error("Jira OAuth token endpoint response is missing access_token");
  }
  if (typeof raw.expires_in !== "number") {
    throw new Error("Jira OAuth token endpoint response is missing expires_in");
  }
  const scopes = typeof raw.scope === "string" && raw.scope.length > 0 ? raw.scope.split(" ") : [];
  return { accessToken: raw.access_token, expiresInSeconds: raw.expires_in, scopes };
}

/**
 * Builds a `FetchJiraOAuthToken` closure bound to `credentials` and
 * `httpClient`. Every call resolves fresh secret values (client id/secret
 * may rotate between calls without restarting the process) and issues
 * exactly one POST — never retried blindly by this module itself (a
 * refresh failure surfaces to `JiraTokenManager`, which owns its own
 * retry/caching discipline).
 */
export function buildJiraOAuthTokenFetcher(
  credentials: JiraOAuthClientCredentials,
  httpClient: GatewayHttpClient,
  options: JiraOAuthHttpOptions = {},
): FetchJiraOAuthToken {
  const tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;

  return async function fetchToken(): Promise<JiraOAuthTokenResponse> {
    const [clientId, clientSecret] = await Promise.all([
      resolveSecretReference(credentials.clientId),
      resolveSecretReference(credentials.clientSecret),
    ]);

    const body = JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: credentials.audience ?? DEFAULT_AUDIENCE,
      scope: credentials.scopes.join(" "),
    });

    const response = await httpClient.request({
      connectionId: "jira-oauth-token-endpoint",
      tenant: "oauth",
      resource: "token",
      url: new URL(tokenUrl),
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    if (response.status >= 400) {
      throw new Error(`Jira OAuth token endpoint responded with HTTP ${response.status}`);
    }

    return toTokenResponse(parseTokenResponseBody(response.bodyText));
  };
}

import { ConnectorError } from "@eo/contracts";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";

/**
 * OAuth 2.0 client-credentials token manager — roadmap/18 §In scope:
 * "service-account OAuth 2.0 client credentials (60-min tokens, refreshed
 * by this phase's token manager, held only as a secret reference — never
 * a literal in worker-reachable state)." Work item 1, entry point: "an
 * expired/not-yet-refreshed token must be rejected before any resource
 * call fires."
 *
 * Deliberately HTTP-transport-agnostic: `fetchToken` is caller-supplied
 * (production wiring, `./jira-oauth-http.ts`, builds it over
 * `@eo/gateway`'s `GatewayHttpClient` so the token-exchange POST itself
 * gets the SSRF-guarded transport stack; tests inject a scripted stub).
 * The manager owns only the cache/refresh/clock-skew state machine.
 *
 * Every failure path — a rejected fetch, a non-positive expiry, a missing
 * access token — throws `ConnectorError.authentication` and NEVER caches
 * a partial/failed result, so a subsequent call always retries rather
 * than being stuck on a poisoned cache entry. The raw fetch failure's
 * message is never echoed verbatim (it may embed a client secret in a
 * URL-encoded request-body error, or an internal diagnostic) — only a
 * generic, redacted summary crosses into the thrown error.
 */
export interface JiraOAuthTokenResponse {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly scopes: readonly string[];
}

export type FetchJiraOAuthToken = () => Promise<JiraOAuthTokenResponse>;

export interface JiraTokenManagerOptions {
  readonly fetchToken: FetchJiraOAuthToken;
  readonly clock?: () => Date;
  /** Seconds subtracted from the token's reported expiry before it is considered stale (clock-skew guard). Default 60s. */
  readonly clockSkewBufferSeconds?: number;
}

export interface JiraAccessToken {
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number; // epoch ms
}

const DEFAULT_CLOCK_SKEW_BUFFER_SECONDS = 60;

function authenticationFailure(detail: string): ConnectorError {
  return ConnectorError.authentication({
    message: `Jira OAuth token acquisition failed: ${detail}`,
    provider: JIRA_PROVIDER_NAME,
    retryable: true,
  });
}

export class JiraTokenManager {
  readonly #fetchToken: FetchJiraOAuthToken;
  readonly #clock: () => Date;
  readonly #bufferMs: number;
  #cached: JiraAccessToken | undefined;
  #inFlight: Promise<JiraAccessToken> | undefined;

  constructor(options: JiraTokenManagerOptions) {
    this.#fetchToken = options.fetchToken;
    this.#clock = options.clock ?? (() => new Date());
    this.#bufferMs = (options.clockSkewBufferSeconds ?? DEFAULT_CLOCK_SKEW_BUFFER_SECONDS) * 1000;
  }

  /**
   * Returns a fresh (not stale, per the clock-skew buffer) access token —
   * refreshing first if necessary. NEVER returns an expired/about-to-
   * expire token; a refresh failure rejects rather than falling back to a
   * stale cached value.
   */
  async getAccessToken(): Promise<JiraAccessToken> {
    const now = this.#clock().getTime();
    if (this.#cached !== undefined && this.#cached.expiresAt - this.#bufferMs > now) {
      return this.#cached;
    }
    if (this.#inFlight !== undefined) {
      return this.#inFlight;
    }
    const attempt = this.#refresh(now);
    this.#inFlight = attempt;
    try {
      return await attempt;
    } finally {
      this.#inFlight = undefined;
    }
  }

  /** Forces the next `getAccessToken()` call to re-fetch, even within the TTL. */
  invalidate(): void {
    this.#cached = undefined;
  }

  async #refresh(now: number): Promise<JiraAccessToken> {
    let response: JiraOAuthTokenResponse;
    try {
      response = await this.#fetchToken();
    } catch (err) {
      throw authenticationFailure(
        err instanceof Error ? "token endpoint request failed" : "unknown token-fetch failure",
      );
    }

    if (response.accessToken.length === 0) {
      throw authenticationFailure("token response carried an empty access token");
    }
    if (response.expiresInSeconds <= 0) {
      throw authenticationFailure("token response carried a non-positive expiry");
    }

    const token: JiraAccessToken = {
      accessToken: response.accessToken,
      scopes: response.scopes,
      expiresAt: now + response.expiresInSeconds * 1000,
    };
    this.#cached = token;
    return token;
  }
}

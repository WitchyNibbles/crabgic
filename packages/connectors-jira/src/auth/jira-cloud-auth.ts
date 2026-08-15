import { ConnectorError } from "@crabgic/contracts";
import type { GatewayHttpClient } from "@crabgic/gateway";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import type { JiraConnectionConfig } from "../provider/jira-connection-config.js";
import {
  buildJiraBasicAuthHeaderProvider,
  type JiraAuthHeaderProvider,
} from "./jira-datacenter-auth.js";
import { buildJiraOAuthTokenFetcher } from "./jira-oauth-http.js";
import { JiraTokenManager } from "./token-manager.js";

/**
 * Resolves the `JiraAuthHeaderProvider` for a Jira CLOUD connection — the
 * Cloud counterpart to `./jira-datacenter-auth.ts`'s
 * `resolveJiraDatacenterAuthHeaderProvider`, and the reason a Cloud
 * connection can authenticate at all.
 *
 * WHY THIS EXISTS (issue #135, adjacent note promoted to a defect).
 * `../resource-client/http-read-helper.ts` hardcoded
 * `Bearer ${token.accessToken}` and the only credential shape Cloud could
 * express was OAuth 2.0 client credentials. But Atlassian REJECTS API
 * tokens (`ATATT…`) presented as Bearer — they authenticate only as HTTP
 * Basic `email:token` — and an API token is the credential an operator
 * actually holds. So the one documented, self-service Cloud credential
 * had no representable path, and `--reference env:JIRA_TOKEN` could never
 * have worked however much else was fixed.
 *
 * THE `allowBasicAuth` GATE IS DELIBERATELY NOT APPLIED HERE. roadmap/19
 * introduced it for Data Center, where `authMode: "basic"` means a real
 * directory username and password, and requiring an explicit opt-in for
 * that is right. On Cloud, "basic" means an email plus a scoped,
 * individually-revocable API token — Atlassian's own recommended
 * mechanism, not a fallback — so gating it behind an opt-in would refuse
 * the normal path and teach operators to set a flag that means "yes, I
 * accept a weaker credential" about a credential that is not weaker.
 * `assertBasicAuthPermitted` remains untouched and DC-only.
 */
export interface JiraCloudAuthOptions {
  /** Required for `authMode: "oauth"` only — the SSRF-guarded client the token-endpoint POST goes through. Never used by the basic path, which performs no network I/O of its own. */
  readonly httpClient?: GatewayHttpClient;
  /** Overrides the OAuth token endpoint. Production omits it. */
  readonly tokenUrl?: string;
}

function refuse(message: string): never {
  throw ConnectorError.authentication({ message, provider: JIRA_PROVIDER_NAME, retryable: false });
}

function missingSecretRef(field: string): never {
  refuse(
    `Jira Cloud connection config is missing required secret reference "${field}" for its configured authMode`,
  );
}

export function resolveJiraCloudAuthHeaderProvider(
  config: JiraConnectionConfig,
  options: JiraCloudAuthOptions = {},
): JiraAuthHeaderProvider {
  if (config.deploymentType !== "cloud") {
    refuse(
      `resolveJiraCloudAuthHeaderProvider was given a "${config.deploymentType}" connection — ` +
        `use resolveJiraDatacenterAuthHeaderProvider for Data Center`,
    );
  }

  switch (config.authMode) {
    case "basic": {
      if (config.basicAuthUsernameSecretRef === undefined) {
        missingSecretRef("basicAuthUsernameSecretRef");
      }
      if (config.basicAuthPasswordSecretRef === undefined) {
        missingSecretRef("basicAuthPasswordSecretRef");
      }
      // Reused verbatim from the DC module rather than re-derived: the
      // header CONSTRUCTION is identical, and a second base64 builder is
      // a second thing to get wrong. Only the policy around it differs.
      return buildJiraBasicAuthHeaderProvider(
        config.basicAuthUsernameSecretRef,
        config.basicAuthPasswordSecretRef,
      );
    }
    case "oauth": {
      if (config.oauthClientIdSecretRef === undefined) missingSecretRef("oauthClientIdSecretRef");
      if (config.oauthClientSecretRef === undefined) missingSecretRef("oauthClientSecretRef");
      if (options.httpClient === undefined) {
        refuse(
          "Jira Cloud OAuth requires an HTTP client for the token endpoint — none was supplied",
        );
      }
      const manager = new JiraTokenManager({
        fetchToken: buildJiraOAuthTokenFetcher(
          {
            clientId: config.oauthClientIdSecretRef,
            clientSecret: config.oauthClientSecretRef,
            scopes: [],
          },
          options.httpClient,
          options.tokenUrl !== undefined ? { tokenUrl: options.tokenUrl } : {},
        ),
      });
      return async () => ({
        authorization: `Bearer ${(await manager.getAccessToken()).accessToken}`,
      });
    }
    case "pat":
      return refuse(
        "authMode 'pat' is a Jira Data Center concept with no Cloud equivalent — " +
          "use 'basic' (email + API token) or 'oauth' (service-account client credentials)",
      );
    /* c8 ignore next 3 -- exhaustiveness guard; JIRA_AUTH_MODES is a closed union */
    default: {
      const _exhaustive: never = config.authMode;
      return refuse(String(_exhaustive));
    }
  }
}

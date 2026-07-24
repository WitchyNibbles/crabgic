import { ConnectorError, type SecretReference } from "@eo/contracts";
import { resolveSecretReference } from "@eo/gateway";
import { JIRA_DATACENTER_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import {
  assertBasicAuthPermitted,
  type JiraConnectionConfig,
} from "../provider/jira-connection-config.js";
import { JiraTokenManager } from "./token-manager.js";

/**
 * roadmap/19-jira-datacenter-adapter.md work item 1: "PAT/bearer default
 * (`authMode: 'pat'`), `allowBasicAuth` opt-in guard." Data Center's
 * REST v2/Agile GETs need a Basic-auth header shape Cloud's OAuth flow
 * never does, so this connector's DC read helper
 * (`../resource-client/datacenter/jira-datacenter-http-context.ts`) is
 * built against this narrower abstraction — an async header-builder —
 * rather than `../resource-client/http-read-helper.ts`'s Cloud-only,
 * hardcoded `Bearer ${token.accessToken}` construction.
 */
export type JiraAuthHeaderProvider = () => Promise<Readonly<Record<string, string>>>;

/** A PAT never expires the way an OAuth token does, but a generous synthetic TTL still lets this provider reuse `JiraTokenManager`'s cache/single-flight/clock-skew machinery UNCHANGED rather than re-deriving it. */
const PAT_SYNTHETIC_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Resolves `patSecretRef` fresh on every underlying refresh (never cached
 * as a literal beyond `JiraTokenManager`'s own in-memory token cache) and
 * returns a `Bearer` authorization header — Jira Data Center's PAT auth
 * scheme is identical to Cloud's OAuth Bearer scheme, so wrapping a
 * `JiraTokenManager` here reuses its authentication-failure wrapping
 * (a rejected/empty token becomes `ConnectorError.authentication`, never a
 * raw thrown string) for free.
 */
export function buildJiraPatAuthHeaderProvider(
  patSecretRef: SecretReference,
): JiraAuthHeaderProvider {
  const manager = new JiraTokenManager({
    fetchToken: async () => {
      const pat = await resolveSecretReference(patSecretRef);
      return { accessToken: pat, expiresInSeconds: PAT_SYNTHETIC_TTL_SECONDS, scopes: [] };
    },
  });
  return async () => {
    const token = await manager.getAccessToken();
    return { authorization: `Bearer ${token.accessToken}` };
  };
}

/**
 * Resolves both secret references fresh on every call (no caching layer —
 * unlike PAT/OAuth, HTTP Basic carries no expiry concept to cache
 * against) and returns a base64-encoded `Basic` authorization header.
 * Only ever reachable once `assertBasicAuthPermitted` has already passed
 * (`resolveJiraDatacenterAuthHeaderProvider` below is the sole production
 * call site that wires this).
 */
export function buildJiraBasicAuthHeaderProvider(
  usernameSecretRef: SecretReference,
  passwordSecretRef: SecretReference,
): JiraAuthHeaderProvider {
  return async () => {
    const [username, password] = await Promise.all([
      resolveSecretReference(usernameSecretRef),
      resolveSecretReference(passwordSecretRef),
    ]);
    const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    return { authorization: `Basic ${token}` };
  };
}

function missingSecretRef(field: string): never {
  throw ConnectorError.validation({
    message: `Jira Data Center connection config is missing required secret reference "${field}" for its configured authMode`,
    provider: JIRA_DATACENTER_PROVIDER_NAME,
    retryable: false,
  });
}

/**
 * Resolves the correct `JiraAuthHeaderProvider` for `config` — the ONE
 * production call site every Data Center connection wiring path
 * (`../provider/jira-datacenter-connection-registry.ts`) goes through.
 * `assertBasicAuthPermitted` runs FIRST, synchronously, before any secret
 * reference is even read — roadmap/19's own stated requirement: "REJECT
 * pre-network with canonical `authentication`."
 */
export function resolveJiraDatacenterAuthHeaderProvider(
  config: JiraConnectionConfig,
): JiraAuthHeaderProvider {
  assertBasicAuthPermitted(config);

  switch (config.authMode) {
    case "pat": {
      if (config.patSecretRef === undefined) missingSecretRef("patSecretRef");
      return buildJiraPatAuthHeaderProvider(config.patSecretRef);
    }
    case "basic": {
      if (config.basicAuthUsernameSecretRef === undefined) {
        missingSecretRef("basicAuthUsernameSecretRef");
      }
      if (config.basicAuthPasswordSecretRef === undefined) {
        missingSecretRef("basicAuthPasswordSecretRef");
      }
      return buildJiraBasicAuthHeaderProvider(
        config.basicAuthUsernameSecretRef,
        config.basicAuthPasswordSecretRef,
      );
    }
    case "oauth":
      // Cloud's OAuth client-credentials flow (18's `JiraTokenManager` +
      // `buildJiraOAuthTokenFetcher`) is unmodified and out of this
      // phase's scope for a `datacenter`-deployed connection — no DC
      // OAuth flow is built here, and none is silently assumed.
      throw ConnectorError.unsupported({
        message:
          "authMode 'oauth' is not implemented for Jira Data Center connections by this connector — use 'pat' (default) or 'basic' (opt-in)",
        provider: JIRA_DATACENTER_PROVIDER_NAME,
        retryable: false,
      });
    /* c8 ignore next 2 -- exhaustiveness guard; JIRA_AUTH_MODES is a closed union */
    default: {
      const _exhaustive: never = config.authMode;
      return missingSecretRef(String(_exhaustive));
    }
  }
}

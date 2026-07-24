import { ConnectorError, SecretReferenceSchema } from "@eo/contracts";
import { z } from "zod";
import { JIRA_DATACENTER_PROVIDER_NAME } from "../errors/jira-error-mapping.js";

/**
 * `JiraDeploymentType` — roadmap/19-jira-datacenter-adapter.md §Interfaces
 * produced: "new closed union; no prior phase names it." Selects which of
 * 18's shared `JiraResourceClient` contract implementations (Cloud REST
 * v3, this phase's Data Center REST v2 + Agile) a given connection uses.
 * Deliberately NOT added to P02's `ExternalConnection` (which already
 * carries a generic, provider-opaque `deploymentType?: string` field for
 * 16's own routing purposes) — `JiraConnectionConfig` below is this
 * package's own closed-union projection of that generic field, nested
 * alongside the connection, never replacing it.
 */
export const JIRA_DEPLOYMENT_TYPES = ["cloud", "datacenter"] as const;
export type JiraDeploymentType = (typeof JIRA_DEPLOYMENT_TYPES)[number];

/**
 * `JiraAuthMode` — roadmap/19 §Interfaces produced: "`authMode: 'oauth' |
 * 'pat' | 'basic'`." `"oauth"` names Cloud's existing service-account
 * client-credentials flow (18's `JiraTokenManager` +
 * `buildJiraOAuthTokenFetcher`, unmodified by this phase); `"pat"`
 * (default for `datacenter`) and `"basic"` (opt-in only) are this phase's
 * own additions, resolved by `../auth/jira-datacenter-auth.ts`.
 */
export const JIRA_AUTH_MODES = ["oauth", "pat", "basic"] as const;
export type JiraAuthMode = (typeof JIRA_AUTH_MODES)[number];

/**
 * `JiraConnectionConfig` — roadmap/19 §Interfaces produced: "new fields on
 * the Jira connection config: `deploymentType`, `authMode`,
 * `allowBasicAuth: boolean` (default `false`). Extends whatever bare
 * `authMode: 'oauth'`-only config 18 defines." (18 never in fact
 * materialized a standalone config type of its own — its Cloud OAuth
 * wiring is constructed ad hoc from `ExternalConnection` +
 * `JiraOAuthClientCredentials` — so this is this phase's first
 * introduction of the type, extending that implicit shape.)
 *
 * Deliberately keyed by `externalConnectionId` rather than embedding a
 * full `ExternalConnection` — this config is this package's own
 * auth/deployment-selection companion object for a connection already
 * separately validated against P02's `ExternalConnectionSchema`, matching
 * roadmap/19's explicit "no change to `ExternalConnection` itself."
 *
 * `.strict()`, so an unrecognized field is a boundary-validation failure,
 * matching this package's existing zod-at-every-boundary convention
 * (`../resource-client/schemas.ts` et al.). Cross-field validity (e.g.
 * "does `authMode: 'pat'` actually carry a `patSecretRef`?") is
 * deliberately NOT a zod `.refine` here — `assertBasicAuthPermitted`
 * below (and `../auth/jira-datacenter-auth.ts`'s auth-header resolver)
 * enforce that as a typed `ConnectorError.authentication`, not a schema
 * parse failure, so the failure mode matches this phase's own stated
 * requirement: "REJECT pre-network with canonical `authentication`," not
 * a generic zod `ZodError`.
 */
export const JiraConnectionConfigSchema = z
  .object({
    externalConnectionId: z.string().min(1),
    deploymentType: z.enum(JIRA_DEPLOYMENT_TYPES),
    authMode: z.enum(JIRA_AUTH_MODES),
    allowBasicAuth: z.boolean().default(false),
    patSecretRef: SecretReferenceSchema.optional(),
    basicAuthUsernameSecretRef: SecretReferenceSchema.optional(),
    basicAuthPasswordSecretRef: SecretReferenceSchema.optional(),
  })
  .strict();

export type JiraConnectionConfig = z.infer<typeof JiraConnectionConfigSchema>;

/**
 * The pre-network `authMode: "basic"` opt-in guard — roadmap/19 §In scope:
 * "basic auth exists only behind an explicit `allowBasicAuth` opt-in on
 * the config. A `datacenter` connection carrying a basic-auth secret
 * reference with `allowBasicAuth` unset (default `false`) is rejected
 * pre-network with canonical `authentication` (P02)." Synchronous, no I/O
 * — called BEFORE any secret reference is ever resolved
 * (`../auth/jira-datacenter-auth.ts`'s `resolveJiraDatacenterAuthHeaderProvider`
 * calls this first), so a disallowed basic-auth config never even reaches
 * secret resolution, let alone a network call. A non-`"basic"` `authMode`
 * is never gated by this function at all — `allowBasicAuth` has no
 * bearing on `"oauth"`/`"pat"`.
 */
export function assertBasicAuthPermitted(config: JiraConnectionConfig): void {
  if (config.authMode === "basic" && !config.allowBasicAuth) {
    throw ConnectorError.authentication({
      message:
        "Jira Data Center basic authentication is disabled for this connection — set allowBasicAuth: true to opt in",
      provider: JIRA_DATACENTER_PROVIDER_NAME,
      retryable: false,
    });
  }
}

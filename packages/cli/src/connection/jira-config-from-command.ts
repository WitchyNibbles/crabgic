/**
 * Turns `connection add`'s Jira flags into a validated
 * `JiraConnectionConfig` — the connector's own auth/deployment companion
 * object, persisted by `./jira-config-store.ts`.
 *
 * roadmap/19 §Out of scope, line 97: "This phase asserts no CLI flag names
 * ... as settled — that surface belongs to 09/23. Whoever wires the CLI
 * should read `JiraConnectionConfig` (this phase) as the contract to
 * expose, not invent a parallel shape." So the members below are that
 * shape's, one flag each, and the result is parsed by the connector's own
 * schema before it is returned — the CLI must not be able to write a
 * config the connector then refuses to read, which would move the failure
 * from `connection add` to first dispatch. That relocation is the whole
 * pattern of issue #135.
 *
 * WHAT `--reference` MEANS. It stays the PRIMARY credential in every mode
 * — the OAuth client secret, the basic password (on Cloud, the API
 * token), or the PAT — so the flag operators already use keeps meaning
 * "the secret". `--username-ref` and `--client-id-ref` name the second
 * half a mode needs, never a duplicate of the first.
 */

import {
  JIRA_AUTH_MODES,
  JiraConnectionConfigSchema,
  type JiraAuthMode,
  type JiraConnectionConfig,
} from "@crabgic/connectors-jira";
import type { ConnectionAddCommand } from "../argv/types.js";
import { CliUsageError } from "../errors.js";
import { toStoredSecretRef } from "./stored-secret-ref.js";

/**
 * The mode an operator gets by naming none.
 *
 * CLOUD DEFAULTS TO `basic`, deliberately. An Atlassian Cloud API token
 * (`ATATT…`) is the credential a person can self-serve, and it
 * authenticates ONLY as HTTP Basic `email:token` — Atlassian rejects it
 * as a Bearer token. OAuth needs an app registration and a service
 * account, which is not the path a first `connection add` is on. The
 * previous implicit default was OAuth-Bearer-only, which is exactly why
 * `--reference env:JIRA_TOKEN` could never have worked (issue #135).
 *
 * DATA CENTER DEFAULTS TO `pat`, which is roadmap/19's own stated default
 * ("PAT/bearer default (`authMode: 'pat'`)").
 */
const DEFAULT_AUTH_MODE: Readonly<Record<string, JiraAuthMode>> = {
  cloud: "basic",
  datacenter: "pat",
};

function parseAuthMode(raw: string | undefined, deploymentType: string): JiraAuthMode {
  if (raw === undefined) {
    const fallback = DEFAULT_AUTH_MODE[deploymentType];
    /* c8 ignore next -- unreachable: the deployment is validated upstream by resolveDispatchProviderKey */
    if (fallback === undefined)
      throw new CliUsageError(`no default auth mode for "${deploymentType}"`);
    return fallback;
  }
  if (!(JIRA_AUTH_MODES as readonly string[]).includes(raw)) {
    throw new CliUsageError(
      `flag "--auth-mode" must be one of ${JIRA_AUTH_MODES.join("|")} (got "${raw}")`,
    );
  }
  return raw as JiraAuthMode;
}

/** Rejects a mode/deployment pair the connector has no implementation for, at `connection add` rather than at first dispatch. */
function assertModeFitsDeployment(authMode: JiraAuthMode, deploymentType: string): void {
  if (authMode === "pat" && deploymentType === "cloud") {
    throw new CliUsageError(
      'auth mode "pat" is a Data Center concept with no cloud equivalent — ' +
        'use "basic" (email + API token) or "oauth" (service-account client credentials)',
    );
  }
  if (authMode === "oauth" && deploymentType === "datacenter") {
    throw new CliUsageError(
      'auth mode "oauth" is not implemented for Jira Data Center by this connector — ' +
        'use "pat" (default) or "basic"',
    );
  }
}

/**
 * Returns the config to persist beside a newly-created Jira connection,
 * or `undefined` for a provider that has none (Grafana carries its auth
 * on the `ExternalConnection` alone).
 */
export function buildJiraConnectionConfig(
  cmd: ConnectionAddCommand,
  externalConnectionId: string,
): JiraConnectionConfig | undefined {
  if (cmd.provider !== "jira") return undefined;

  const deploymentType = cmd.deploymentType ?? "cloud";
  const authMode = parseAuthMode(cmd.authMode, deploymentType);
  assertModeFitsDeployment(authMode, deploymentType);

  const primary = toStoredSecretRef(cmd.reference.raw);

  const credentials = (): Partial<JiraConnectionConfig> => {
    switch (authMode) {
      case "basic": {
        if (cmd.usernameReference === undefined) {
          throw new CliUsageError(
            'auth mode "basic" requires --username-ref <secret-reference> ' +
              "(on Jira Cloud, the account email that pairs with the API token in --reference)",
          );
        }
        return {
          basicAuthUsernameSecretRef: toStoredSecretRef(cmd.usernameReference.raw),
          basicAuthPasswordSecretRef: primary,
        };
      }
      case "oauth": {
        if (cmd.clientIdReference === undefined) {
          throw new CliUsageError(
            'auth mode "oauth" requires --client-id-ref <secret-reference> ' +
              "(the client secret is --reference)",
          );
        }
        return {
          oauthClientIdSecretRef: toStoredSecretRef(cmd.clientIdReference.raw),
          oauthClientSecretRef: primary,
        };
      }
      case "pat":
        return { patSecretRef: primary };
    }
  };

  // Parsed by the CONNECTOR's schema, not merely typed as its interface:
  // this is the boundary where a CLI-shaped object becomes a connector
  // contract, and `.strict()` catching a stray member here is worth more
  // than the same failure surfacing on first dispatch.
  return JiraConnectionConfigSchema.parse({
    externalConnectionId,
    deploymentType,
    authMode,
    allowBasicAuth: cmd.allowBasicAuth,
    ...credentials(),
  });
}

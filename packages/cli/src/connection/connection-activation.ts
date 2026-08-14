/**
 * The connection-activation lifecycle — the call site whose absence was
 * issue #135's defect 3, and the one the reporter correctly identified as
 * gating the other two.
 *
 * THE DEFECT. Each connector keeps a per-connection registry behind its
 * single provider-keyed client, because one provider key
 * (`"jira-cloud"`, `"grafana"`) serves many sites, each with its own base
 * URL, credentials and route table. `buildProviderDispatchWiring` created
 * both registries, returned them — and nothing ever called
 * `register(connection, …)` on either. `dispatch.jira` and
 * `dispatch.grafana` had no call sites outside that construction, so
 * `registry.get(connectionId)` threw "was never registered" for every
 * connection that had ever existed. The routed clients resolved fine; the
 * lookup behind them was permanently empty, and no connector could serve
 * a single request.
 *
 * WHY LAZY, NOT A BOOT SWEEP. Activation resolves credentials and (for
 * Grafana) needs a live capability snapshot. Doing it for every stored
 * connection at boot would let one unreachable host stop `gateway mcp`
 * from starting, and would resolve secrets for connections a session
 * never touches. So the gateway calls the activator on every dispatch,
 * and this module makes the repeat calls cheap.
 *
 * FAILURES ARE NOT CACHED. A connection whose credential was not exported
 * yet must succeed on the next call once it is — caching the rejection
 * would make a fixed environment look permanently broken. Only SUCCESS is
 * remembered.
 */

import { ConnectorError, type ExternalConnection } from "@crabgic/contracts";
import {
  JIRA_CLOUD_PROVIDER_KEY,
  resolveJiraCloudAuthHeaderProvider,
  type JiraConnectionRegistry,
} from "@crabgic/connectors-jira";
import { buildHttpClientForConnection, type GatewayHttpClient } from "@crabgic/gateway";
import type { JiraConnectionConfigStore } from "./jira-config-store.js";

export interface ConnectionActivatorDeps {
  readonly jira: JiraConnectionRegistry;
  readonly jiraConfigs: JiraConnectionConfigStore;
  /** Test-only seam — production defaults to the real SSRF/DNS/TLS stack. */
  readonly buildJiraHttpClient?: (connection: ExternalConnection) => Promise<GatewayHttpClient>;
}

/**
 * Returns the idempotent, single-flighting `activateConnection` the
 * gateway's dispatch tools call before using a connection.
 *
 * A provider this activator does not own is a NO-OP rather than an error:
 * dispatch will fail its own way (`UnknownProviderError`) with a better
 * message than anything this layer could invent, and a third-party
 * provider key must not be made undispatchable by an activator that has
 * never heard of it.
 */
export function createConnectionActivator(
  deps: ConnectionActivatorDeps,
): (connection: ExternalConnection) => Promise<void> {
  // Keyed by connection id. Holds only IN-FLIGHT and SUCCEEDED
  // activations — a rejected entry is evicted so the next call retries.
  const inFlight = new Map<string, Promise<void>>();

  async function activateJiraCloud(connection: ExternalConnection): Promise<void> {
    const config = await deps.jiraConfigs.get(connection.id);
    if (config === undefined) {
      // A canonical ConnectorError, NOT a CliUsageError: this surfaces
      // through an MCP tool result, where `mapUnknownErrorToConnectorError`
      // would classify an unrecognized error as `transient` +
      // `retryable: true`. A connection with no stored config is
      // permanently misconfigured — telling a caller to retry it would
      // have them retry forever.
      throw ConnectorError.validation({
        message:
          `Jira connection "${connection.id}" has no stored auth config — ` +
          "re-add it with `crabgic connection add jira` so its credential shape is recorded",
        provider: connection.provider,
        retryable: false,
      });
    }

    const httpClient = await (deps.buildJiraHttpClient ?? buildHttpClientForConnection)(connection);
    // Built from the connection's OWN config: the scheme an operator
    // chose, never a hardcoded Bearer (issue #135's adjacent note).
    const authHeaderProvider = resolveJiraCloudAuthHeaderProvider(config, { httpClient });

    // No token manager: a Basic-auth connection has no token to manage,
    // and the auth-header provider is the authority either way.
    await deps.jira.register(connection, undefined, {
      authHeaderProvider,
      buildHttpClient: async () => httpClient,
    });
  }

  return async function activateConnection(connection: ExternalConnection): Promise<void> {
    if (connection.provider !== JIRA_CLOUD_PROVIDER_KEY) return;
    if (deps.jira.isRegistered(connection.id)) return;

    const existing = inFlight.get(connection.id);
    if (existing !== undefined) return existing;

    const attempt = activateJiraCloud(connection).finally(() => {
      // Evicted on BOTH paths: on success `isRegistered` short-circuits
      // future calls, and on failure the next call must get a fresh
      // attempt rather than a cached rejection.
      inFlight.delete(connection.id);
    });
    inFlight.set(connection.id, attempt);
    return attempt;
  };
}

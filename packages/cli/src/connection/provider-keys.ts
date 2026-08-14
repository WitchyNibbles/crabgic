/**
 * The one place the CLI's user-facing provider vocabulary (`jira`,
 * `grafana`) is turned into the PROVIDER-DISPATCH KEY a stored
 * `ExternalConnection` carries — and the one place a record written by an
 * older CLI is migrated onto that key.
 *
 * WHY THIS MODULE EXISTS (issue #135, defect 2). `connection add jira`
 * stored `provider: "jira"`, `registerJiraCloudProvider` registers under
 * `JIRA_PROVIDER_NAME` (`"jira-cloud"`), and
 * `ProviderRegistry.resolve(connection.provider)` is the only thing that
 * joins them — so every Jira connection ever created failed dispatch with
 * `no client registered for provider "jira"`, and `"jira-cloud"` was not
 * even reachable as a record value because the argv parser refused it.
 * Two spellings of one concept, with nothing forcing them to agree.
 *
 * THE RULING (owner, 2026-08-14, option A). `ExternalConnectionSchema`
 * already documents `provider` as "the provider-dispatch key," so the
 * record is what moves, not the registration: `connection add` resolves
 * the key here, and the connectors' own exported constants stay
 * authoritative. The alternative considered — resolving a key from
 * `(provider, deploymentType)` at every dispatch site — was declined: it
 * adds an indirection layer the interface ledger does not have, and it
 * leaves the un-dispatchable value in the store where the next reader
 * meets it again.
 *
 * The CLI's `jira|grafana` argv vocabulary is deliberately UNCHANGED —
 * the deployment fork is expressed by `--deployment`, exactly as
 * `JiraConnectionConfig`'s own `JIRA_DEPLOYMENT_TYPES` union frames it
 * (roadmap/19: "whoever wires the CLI should read `JiraConnectionConfig`
 * as the contract to expose, not invent a parallel shape").
 */

import type { ExternalConnection } from "@crabgic/contracts";
import {
  JIRA_CLOUD_PROVIDER_KEY,
  JIRA_DATACENTER_PROVIDER_KEY,
  JIRA_DEPLOYMENT_TYPES,
} from "@crabgic/connectors-jira";
import { GRAFANA_PROVIDER_NAME } from "@crabgic/connectors-grafana";
import type { ExternalConnectionRepository } from "@crabgic/gateway";
import type { ConnectionProvider } from "../argv/types.js";
import { CliUsageError } from "../errors.js";

/**
 * The pre-#135 spelling. Never produced any more, still readable: a
 * record created by 1.7.0 or earlier carries it, and refusing to read
 * those would turn a dispatch bug into data loss.
 */
export const LEGACY_JIRA_PROVIDER_VALUE = "jira";

/** Jira's deployment fork, as dispatch keys. Keyed off the connector's own closed union so a new member cannot be added there and silently missed here. */
const JIRA_DEPLOYMENT_KEYS: Readonly<Record<(typeof JIRA_DEPLOYMENT_TYPES)[number], string>> = {
  cloud: JIRA_CLOUD_PROVIDER_KEY,
  datacenter: JIRA_DATACENTER_PROVIDER_KEY,
};

/**
 * Jira Cloud is the default deployment when `--deployment` is omitted:
 * it is the deployment `connection add`'s own `--base-url` help text
 * describes, and the one the 1.7.0 records in the wild were created
 * against, so it is also the migration target that preserves what those
 * records meant.
 */
const DEFAULT_JIRA_DEPLOYMENT = "cloud";

function jiraKeyForDeployment(deploymentType: string): string {
  const key = JIRA_DEPLOYMENT_KEYS[deploymentType as (typeof JIRA_DEPLOYMENT_TYPES)[number]];
  if (key === undefined) {
    throw new CliUsageError(
      `flag "--deployment" must be one of ${JIRA_DEPLOYMENT_TYPES.join("|")} for a jira ` +
        `connection (got "${deploymentType}")`,
    );
  }
  return key;
}

/**
 * Resolves the dispatch key a new connection is stored under. Grafana has
 * exactly one key whatever its edition — roadmap/20 routes it by live
 * capability rather than by declared deployment, so an edition fork here
 * would be a distinction the dispatch side does not make.
 */
export function resolveDispatchProviderKey(
  provider: ConnectionProvider,
  deploymentType: string | undefined,
): string {
  if (provider === "grafana") return GRAFANA_PROVIDER_NAME;
  return jiraKeyForDeployment(deploymentType ?? DEFAULT_JIRA_DEPLOYMENT);
}

/**
 * The `deploymentType` a new record is stored with. For Jira the omitted
 * flag is materialized to its resolved default, so the record states
 * which Jira it is rather than leaving the next reader to re-derive the
 * same default — `JiraConnectionConfig.deploymentType` is a required
 * member of a closed union, and a record that only implies its value
 * cannot be projected onto one. Grafana's is passed through untouched:
 * its edition is a free-form operator note there, not a routing input.
 */
export function resolveStoredDeploymentType(
  provider: ConnectionProvider,
  deploymentType: string | undefined,
): string | undefined {
  if (provider === "grafana") return deploymentType;
  return deploymentType ?? DEFAULT_JIRA_DEPLOYMENT;
}

/**
 * Migrates a stored record's legacy `provider: "jira"` onto its dispatch
 * key. Returns the SAME OBJECT (by identity) when nothing needs changing,
 * so a caller can cheaply tell a migration happened, and never mutates
 * the record it is handed.
 *
 * An unrecognized provider is passed through untouched rather than
 * guessed at: this function's job is to repair one known drift, and a
 * third-party provider key it invents would fail dispatch just as surely,
 * only with a more confusing error.
 */
export function normalizeStoredConnectionProvider(
  connection: ExternalConnection,
): ExternalConnection {
  if (connection.provider !== LEGACY_JIRA_PROVIDER_VALUE) return connection;
  return {
    ...connection,
    provider: jiraKeyForDeployment(connection.deploymentType ?? DEFAULT_JIRA_DEPLOYMENT),
  };
}

/**
 * Wraps an `ExternalConnectionRepository` so every record leaving it
 * carries a dispatch key, whichever CLI version wrote it.
 *
 * Migration is READ-SIDE, not a rewrite pass over the store. The store
 * file is shared with any co-installed older CLI, which would not
 * understand `"jira-cloud"`; a projection applied on the way out cannot
 * corrupt a record that a rollback would then have to un-migrate.
 */
export function withProviderKeyNormalization(
  inner: ExternalConnectionRepository,
): ExternalConnectionRepository {
  return {
    create: async (input) => normalizeStoredConnectionProvider(await inner.create(input)),
    get: async (id) => {
      const found = await inner.get(id);
      return found === undefined ? undefined : normalizeStoredConnectionProvider(found);
    },
    list: async () => (await inner.list()).map(normalizeStoredConnectionProvider),
    update: async (id, patch) => normalizeStoredConnectionProvider(await inner.update(id, patch)),
    remove: (id) => inner.remove(id),
  };
}

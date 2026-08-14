/**
 * `connection add|list|doctor` backends — roadmap/09 §Out of scope defers
 * "`connection add|list|doctor|capabilities`'s real behavior" to the phases
 * that own the gateway, and roadmap/16 §Out of scope mirrors it from the
 * other side: "The `connection add|list|doctor|capabilities` command's
 * parser/argv surface — 09 (ships it `NOT_IMPLEMENTED` until wired); this
 * phase supplies the `ExternalConnection` store and capability-snapshot
 * logic that backend calls into, never the command surface."
 *
 * This module is that missing backend: the CLI-side half that calls into
 * 16's store and reachability probe. It lives in `packages/cli` (not
 * `packages/gateway`) for the same reason `../learning/` and `../intake/`
 * do — the command surface is 09's, and the feature package supplies only
 * the primitives.
 *
 * `connection capabilities` lives in `./connection-capabilities.ts` and is
 * dependency-gated on `ConnectionDependencies.discoverCapabilities` below,
 * the same way the other three are gated on the whole bag.
 *
 * CORRECTED 2026-07-25 (WP5). The previous note here justified that gating
 * partly on the claim that "`@crabgic/connectors-jira`'s
 * `discoverJiraCapabilitySnapshot` needs a `JiraHttpContext` whose
 * `JiraTokenManager` that package does not export." That was FALSE:
 * `JiraTokenManager` has been exported from `@crabgic/connectors-jira`'s public
 * barrel (`src/index.ts`) all along, alongside `FetchJiraOAuthToken` and
 * `JiraTokenManagerOptions`. The real, still-open blockers are narrower
 * and are recorded accurately on `discoverCapabilities` below.
 */
import { EXIT_GENERAL_ERROR, EXIT_OK, formatJson, type CommandResult } from "@crabgic/contracts";
import type { CapabilitySnapshot, ExternalConnection, SecretReference } from "@crabgic/contracts";
import { CliUsageError } from "../errors.js";
import { pluralize, renderItemListReport, renderResultLine } from "../output/reports.js";
import { resolveDispatchProviderKey, resolveStoredDeploymentType } from "./provider-keys.js";
import { toStoredSecretRef } from "./stored-secret-ref.js";
import { buildJiraConnectionConfig } from "./jira-config-from-command.js";
import type { JiraConnectionConfigStore } from "./jira-config-store.js";

/**
 * Stand-in id used only to VALIDATE the credential flags before a
 * connection exists to key them to. Never persisted: the draft is
 * re-keyed to the real id the moment `create` returns one.
 */
const PENDING_CONNECTION_ID = "pending";
import type { ExternalConnectionRepository, ReachabilityProbeResult } from "@crabgic/gateway";
import type {
  ConnectionAddCommand,
  ConnectionDoctorCommand,
  ConnectionListCommand,
} from "../argv/types.js";

export interface ConnectionDependencies {
  readonly repository: ExternalConnectionRepository;
  /** Injected so tests never issue real network I/O; production wires `@crabgic/gateway`'s `probeConnectionReachability`. */
  readonly probe: (connection: ExternalConnection) => Promise<ReachabilityProbeResult>;
  /**
   * Discovers one connection's live `CapabilitySnapshot` — the injected
   * counterpart to `probe`, backing `./connection-capabilities.ts`.
   *
   * OPTIONAL, and `../bootstrap.ts` does NOT supply one today. Both
   * connectors are one concrete piece short, and neither piece can be
   * supplied here without inventing something:
   *
   *  - Jira: `discoverJiraCapabilitySnapshot` is real and calls documented
   *    endpoints (`/rest/api/3/serverInfo`, `/rest/api/3/mypermissions`),
   *    and every part of its `JiraHttpContext` is constructible —
   *    `buildHttpClientForConnection` plus the exported `JiraTokenManager`
   *    over `buildJiraOAuthTokenFetcher`. What is missing is STORAGE for
   *    the OAuth client-credentials PAIR: `JiraConnectionConfigSchema`
   *    gained `oauthClientIdSecretRef`/`oauthClientSecretRef` in WP5, but
   *    nothing persists a `JiraConnectionConfig`, and P02's
   *    `ExternalConnection` carries exactly ONE `secretRef` by a
   *    roadmap/19 ruling that must not be widened.
   *  - Grafana: `GrafanaBuildInfoResponse` is documented in its own file
   *    as "fixture data, not an assertion about Grafana's exact wire
   *    format ... pending live verification". Writing `fetchBuildInfo`
   *    against it would be guessing at an unverified engine fact, which
   *    this repo's ground rules forbid; the containerized Grafana run is
   *    where that gets settled.
   *
   * Leaving it undefined keeps `connection capabilities` visible to
   * `e2e/live`'s NOT_IMPLEMENTED sweep instead of converting a tracked
   * deferral into an always-failing command that merely looks wired.
   */
  readonly discoverCapabilities?: (connection: ExternalConnection) => Promise<CapabilitySnapshot>;
  /**
   * Persists the `JiraConnectionConfig` that says HOW a Jira connection
   * authenticates — the storage whose absence is recorded above, and the
   * reason a Jira Cloud connection could not authenticate at all (issue
   * #135). Optional so a caller that never adds a Jira connection need
   * not supply one; `../bootstrap.ts` always does.
   */
  readonly jiraConfigs?: JiraConnectionConfigStore;
}

/**
 * Renders a secret reference as its LOCATOR only — the env var name, the
 * file path, the exec command. Never resolves it. roadmap/16 §In scope:
 * "secret references only ... never a literal credential in worker- or
 * manager-reachable state"; stdout is the most manager-reachable state
 * there is.
 */
function describeSecretRef(ref: SecretReference): string {
  switch (ref.backend) {
    case "env":
      return `env:${ref.variable}`;
    case "file":
      return `file:${ref.path}`;
    case "exec":
      return `exec:${ref.command}`;
  }
}

/** The redacted projection of a connection that is safe to print. */
function toSummary(connection: ExternalConnection) {
  return {
    id: connection.id,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    ...(connection.deploymentType !== undefined
      ? { deploymentType: connection.deploymentType }
      : {}),
    secretRef: describeSecretRef(connection.secretRef),
    discoveryTtlSeconds: connection.discoveryTtlSeconds,
  };
}

export async function runConnectionAddCommand(
  cmd: ConnectionAddCommand,
  deps: ConnectionDependencies,
): Promise<CommandResult> {
  // The argv word (`jira`) is NOT the stored value: `provider` is the
  // provider-dispatch key `ProviderRegistry.resolve` is called with, and
  // storing the argv word raw is what made every Jira connection created
  // by 1.7.0 and earlier undispatchable (issue #135, defect 2). Resolved
  // BEFORE `create`, so an unknown `--deployment` refuses the command
  // rather than persisting a record nothing can route.
  const provider = resolveDispatchProviderKey(cmd.provider, cmd.deploymentType);
  const deploymentType = resolveStoredDeploymentType(cmd.provider, cmd.deploymentType);

  // Validated BEFORE the connection is created, with a placeholder id: a
  // bad `--auth-mode`/`--username-ref` combination must refuse the whole
  // command, never leave a stored connection whose credentials are
  // unusable — the exact "stores fine, 401s on first use" shape this
  // issue is about. The real id is filled in once `create` assigns one.
  const configDraft = buildJiraConnectionConfig(cmd, PENDING_CONNECTION_ID);

  const created = await deps.repository.create({
    provider,
    baseUrl: cmd.baseUrl,
    ...(deploymentType !== undefined ? { deploymentType } : {}),
    allowedRedirectOrigins: cmd.allowedRedirectOrigins,
    allowedResources: cmd.allowedResources,
    allowedActions: cmd.allowedActions,
    discoveryTtlSeconds: cmd.discoveryTtlSeconds,
    secretRef: toStoredSecretRef(cmd.reference.raw),
  });

  if (configDraft !== undefined) {
    if (deps.jiraConfigs === undefined) {
      // Refused rather than skipped: a Jira connection with no stored
      // config cannot authenticate, and a silent skip would produce
      // exactly the "added successfully, fails on first dispatch"
      // outcome this whole change exists to end.
      throw new CliUsageError(
        "cannot add a Jira connection without a configured Jira config store " +
          "(the credential shape would have nowhere to be recorded)",
      );
    }
    await deps.jiraConfigs.put({ ...configDraft, externalConnectionId: created.id });
  }

  const summary = toSummary(created);
  return {
    exitCode: EXIT_OK,
    stdout: cmd.json
      ? formatJson(summary)
      : renderResultLine(
          "ok",
          `added ${created.provider} connection ${created.id} (${created.baseUrl})`,
        ),
  };
}

export async function runConnectionListCommand(
  cmd: ConnectionListCommand,
  deps: ConnectionDependencies,
): Promise<CommandResult> {
  const connections = await deps.repository.list();
  const summaries = connections.map(toSummary);

  if (cmd.json) {
    return { exitCode: EXIT_OK, stdout: formatJson({ connections: summaries }) };
  }
  if (summaries.length === 0) {
    return {
      exitCode: EXIT_OK,
      stdout: renderResultLine("info", "no external connections configured"),
    };
  }
  return {
    exitCode: EXIT_OK,
    stdout: renderItemListReport({
      role: "info",
      lead: `${pluralize(summaries.length, "connection")}.`,
      title: "Connections",
      items: summaries.map(
        (summary) => `${summary.provider} ${summary.id} ${summary.baseUrl} ${summary.secretRef}`,
      ),
    }),
  };
}

export async function runConnectionDoctorCommand(
  cmd: ConnectionDoctorCommand,
  deps: ConnectionDependencies,
): Promise<CommandResult> {
  const connection = await deps.repository.get(cmd.connectionId);
  if (connection === undefined) {
    const detail = `no connection with id "${cmd.connectionId}"`;
    return {
      exitCode: EXIT_GENERAL_ERROR,
      ...(cmd.json
        ? { stdout: formatJson({ connectionId: cmd.connectionId, reachable: false, detail }) }
        : { stderr: `${detail}\n` }),
    };
  }

  // Never throws for an expected reachability failure — see
  // `probeConnectionReachability`'s own contract. A doctor command that
  // crashed on an unreachable host would be useless precisely when needed.
  const result = await deps.probe(connection);
  const payload = {
    connectionId: connection.id,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    reachable: result.reachable,
    ...(result.status !== undefined ? { status: result.status } : {}),
    detail: result.detail,
  };

  return {
    exitCode: result.reachable ? EXIT_OK : EXIT_GENERAL_ERROR,
    stdout: cmd.json
      ? formatJson(payload)
      : renderResultLine(
          result.reachable ? "ok" : "fail",
          `${connection.provider} ${connection.id}: ${result.reachable ? "reachable" : "UNREACHABLE"} — ${result.detail}`,
        ),
  };
}

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
 * `connection capabilities` is DELIBERATELY ABSENT (2026-07-25). It needs a
 * live `CapabilitySnapshot` discovery call, and neither provider has the
 * production HTTP plumbing for one: `@eo/connectors-grafana` exposes
 * `buildGrafanaCapabilitySnapshotDiscoverer` but its `GrafanaDiscoveryDeps`
 * (`fetchBuildInfo`/`probeRoute`) has no non-fixture implementation
 * anywhere in the repo, and `@eo/connectors-jira`'s
 * `discoverJiraCapabilitySnapshot` needs a `JiraHttpContext` whose
 * `JiraTokenManager` that package does not export. Both are phase 19/20
 * gaps. Fabricating that plumbing here would put unreviewed, credential-
 * attaching HTTP code in the CLI, so the command keeps returning the typed
 * NOT_IMPLEMENTED shape until those phases close the gap.
 */
import { EXIT_GENERAL_ERROR, EXIT_OK, formatJson, type CommandResult } from "@eo/contracts";
import type { ExternalConnection, SecretReference } from "@eo/contracts";
import { CliUsageError } from "../errors.js";
import type { ExternalConnectionRepository, ReachabilityProbeResult } from "@eo/gateway";
import type {
  ConnectionAddCommand,
  ConnectionDoctorCommand,
  ConnectionListCommand,
} from "../argv/types.js";

export interface ConnectionDependencies {
  readonly repository: ExternalConnectionRepository;
  /** Injected so tests never issue real network I/O; production wires `@eo/gateway`'s `probeConnectionReachability`. */
  readonly probe: (connection: ExternalConnection) => Promise<ReachabilityProbeResult>;
}

/**
 * The CLI's argv-level reference forms (`../argv/secret-reference.ts`:
 * `env:NAME`, `op://…`, `vault://…`, `file:///abs/path`, `ref:id`) are a
 * DIFFERENT, wider vocabulary than the stored contract's
 * `SecretReferenceSchema` (02), which has exactly three backends —
 * `env`/`file`/`exec`. This converts the two that have a faithful
 * representation and refuses the rest loudly.
 *
 * Refusing is the correct behavior, not a shortcoming: silently coercing
 * `op://vault/item` into, say, an `exec` backend would invent a resolution
 * mechanism the operator never asked for. Widening
 * `SecretReferenceSchema` to carry secret-manager URIs is a 02 contract
 * change and belongs to whoever adds real support for those backends.
 * (`exec` is unreachable from argv today for the mirror-image reason: the
 * CLI's own reference pattern has no `exec:` form.)
 */
function toStoredSecretRef(raw: string): SecretReference {
  if (raw.startsWith("env:")) {
    return { backend: "env", variable: raw.slice("env:".length) };
  }
  if (raw.startsWith("file://")) {
    return { backend: "file", path: raw.slice("file://".length) };
  }
  throw new CliUsageError(
    `secret reference "${raw.split(":")[0]}:…" is not storable on a connection ` +
      `(supported: env:NAME, file:///abs/path)`,
  );
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
  const created = await deps.repository.create({
    provider: cmd.provider,
    baseUrl: cmd.baseUrl,
    ...(cmd.deploymentType !== undefined ? { deploymentType: cmd.deploymentType } : {}),
    allowedRedirectOrigins: cmd.allowedRedirectOrigins,
    allowedResources: cmd.allowedResources,
    allowedActions: cmd.allowedActions,
    discoveryTtlSeconds: cmd.discoveryTtlSeconds,
    secretRef: toStoredSecretRef(cmd.reference.raw),
  });

  const summary = toSummary(created);
  return {
    exitCode: EXIT_OK,
    stdout: cmd.json
      ? formatJson(summary)
      : `added ${created.provider} connection ${created.id} (${created.baseUrl})\n`,
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
      stdout: "no external connections configured\n",
    };
  }
  const lines = summaries.map(
    (summary) => `${summary.id}  ${summary.provider}  ${summary.baseUrl}  ${summary.secretRef}`,
  );
  return { exitCode: EXIT_OK, stdout: `${lines.join("\n")}\n` };
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
      : `${connection.provider} ${connection.id}: ${result.reachable ? "reachable" : "UNREACHABLE"} — ${result.detail}\n`,
  };
}

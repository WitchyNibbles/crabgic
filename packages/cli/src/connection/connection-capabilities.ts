/**
 * `connection capabilities <id>` — the fourth `connection *` verb, and the
 * last one to get a real backend.
 *
 * Until WP5 (2026-07-25) `../commands/dispatch.ts` answered it with an
 * UNCONDITIONAL `notImplementedResult`: alone among the four verbs it had
 * no branch at all, not even a dependency-gated one. This module is that
 * missing branch, built to `./connection-commands.ts`'s
 * `runConnectionDoctorCommand` shape exactly — the connection is resolved
 * from the SAME durable repository, and the one operation that touches the
 * network is an INJECTED function (`deps.discoverCapabilities`, the
 * counterpart to `deps.probe`), never HTTP code held here. That is the
 * property that lets this command exist without putting unreviewed,
 * credential-attaching transport in `packages/cli`, which is the exact
 * objection that kept it unwired.
 *
 * NEVER THROWS FOR AN EXPECTED FAILURE, for the same reason
 * `runConnectionDoctorCommand` does not: a diagnostic command that crashes
 * is useless precisely when it is needed, and capability discovery is
 * strictly more failure-prone than a reachability probe (it authenticates,
 * then issues several requests). An unknown connection, a missing
 * discoverer and a discovery error are all typed non-zero results.
 */
import { EXIT_GENERAL_ERROR, EXIT_OK, formatJson, type CommandResult } from "@eo/contracts";
import type { ConnectionCapabilitiesCommand } from "../argv/types.js";
import type { ConnectionDependencies } from "./connection-commands.js";

/** A failure payload shaped like the success one, so `--json` consumers can branch on `discovered` alone. */
function failure(connectionId: string, detail: string, json: boolean): CommandResult {
  return {
    exitCode: EXIT_GENERAL_ERROR,
    ...(json
      ? { stdout: formatJson({ connectionId, discovered: false, detail }) }
      : { stderr: `${detail}\n` }),
  };
}

export async function runConnectionCapabilitiesCommand(
  cmd: ConnectionCapabilitiesCommand,
  deps: ConnectionDependencies,
): Promise<CommandResult> {
  const connection = await deps.repository.get(cmd.connectionId);
  if (connection === undefined) {
    // Resolved BEFORE the discoverer is consulted: a fabricated id must
    // never cause an authenticated request to anything.
    return failure(cmd.connectionId, `no connection with id "${cmd.connectionId}"`, cmd.json);
  }

  const discover = deps.discoverCapabilities;
  if (discover === undefined) {
    return failure(
      cmd.connectionId,
      `no capability discoverer is wired for provider "${connection.provider}" in this build — ` +
        `capability discovery needs a provider client with resolved credentials`,
      cmd.json,
    );
  }

  let snapshot;
  try {
    snapshot = await discover(connection);
  } catch (err) {
    return failure(
      cmd.connectionId,
      `capability discovery failed for ${connection.provider} connection ${connection.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      cmd.json,
    );
  }

  // Deliberately projects named fields rather than spreading the snapshot:
  // this is the redacted-projection convention `toSummary` already applies
  // to a connection, and it keeps the command's output stable if
  // `CapabilitySnapshot` later grows a field.
  const payload = {
    connectionId: connection.id,
    provider: connection.provider,
    discovered: true,
    product: snapshot.product,
    edition: snapshot.edition,
    version: snapshot.version,
    apiFamilies: snapshot.apiFamilies,
    resources: snapshot.resources,
    actions: snapshot.actions,
    permissions: snapshot.permissions,
    isReadOnly: snapshot.isReadOnly,
    discoveredAt: snapshot.discoveredAt,
    expiresAt: snapshot.expiresAt,
  };

  return {
    exitCode: EXIT_OK,
    stdout: cmd.json
      ? formatJson(payload)
      : `${snapshot.product} ${snapshot.edition} ${snapshot.version} (${connection.id}): ` +
        `${snapshot.isReadOnly ? "read-only" : "writable"} — ` +
        `${snapshot.resources.length} resource kinds, ${snapshot.actions.length} actions\n`,
  };
}

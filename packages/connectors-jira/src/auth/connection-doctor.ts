import type { ExternalConnection } from "@eo/contracts";
import { probeConnectionReachability, type ReachabilityProbeResult } from "@eo/gateway";
import type { JiraTokenManager } from "./token-manager.js";

/**
 * Connection-doctor scope/expiry check — roadmap/18 §In scope:
 * "connection doctor validates scopes." Built on top of `@eo/gateway`'s
 * `probeConnectionReachability` (16's own end-to-end, non-mutating GET
 * primitive — never reimplemented here) plus this phase's own
 * `JiraTokenManager`, which the same call proves is capable of minting a
 * token carrying every scope the connector needs.
 */
export interface JiraConnectionDoctorInput {
  readonly connection: ExternalConnection;
  readonly tokenManager: JiraTokenManager;
  readonly requiredScopes: readonly string[];
  /** Injectable — defaults to `@eo/gateway`'s `probeConnectionReachability` (test-only escape hatch, mirroring that function's own `buildClient` seam). */
  readonly probe?: (connection: ExternalConnection) => Promise<ReachabilityProbeResult>;
}

export interface JiraConnectionDoctorResult {
  readonly ok: boolean;
  readonly missingScopes: readonly string[];
  readonly reachability?: ReachabilityProbeResult;
  readonly detail: string;
}

export async function runJiraConnectionDoctor(
  input: JiraConnectionDoctorInput,
): Promise<JiraConnectionDoctorResult> {
  const { connection, tokenManager, requiredScopes } = input;
  const probe = input.probe ?? probeConnectionReachability;

  let scopes: readonly string[];
  try {
    const token = await tokenManager.getAccessToken();
    scopes = token.scopes;
  } catch (err) {
    return {
      ok: false,
      missingScopes: requiredScopes,
      detail: `token acquisition failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));

  const reachability = await probe(connection);
  if (!reachability.reachable) {
    return {
      ok: false,
      missingScopes,
      reachability,
      detail: `connection unreachable: ${reachability.detail}`,
    };
  }

  if (missingScopes.length > 0) {
    return {
      ok: false,
      missingScopes,
      reachability,
      detail: `missing required scope(s): ${missingScopes.join(", ")}`,
    };
  }

  return {
    ok: true,
    missingScopes: [],
    reachability,
    detail: "reachable with all required scopes",
  };
}

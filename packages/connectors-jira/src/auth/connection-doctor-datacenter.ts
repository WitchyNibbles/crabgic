import type { ExternalConnection } from "@eo/contracts";
import { probeConnectionReachability, type ReachabilityProbeResult } from "@eo/gateway";
import type { JiraConnectionConfig } from "../provider/jira-connection-config.js";
import { resolveJiraDatacenterAuthHeaderProvider } from "./jira-datacenter-auth.js";

/**
 * Data Center connection-doctor — roadmap/19-jira-datacenter-adapter.md
 * §Interfaces produced: "Doctor-check functions — PAT-validity probe,
 * basic-auth-active finding (non-blocking), connection-reachability probe
 * exercising 16's custom-CA path." Mirrors `./connection-doctor.ts`'s
 * shape/pattern (built on the SAME `@eo/gateway` `probeConnectionReachability`
 * primitive — never reimplemented) but checks a resolvable auth-header
 * provider instead of an OAuth scope list, since Data Center's PAT/basic
 * auth carries no scope concept to validate.
 */
export interface JiraDatacenterConnectionDoctorInput {
  readonly connection: ExternalConnection;
  readonly config: JiraConnectionConfig;
  /** Injectable — defaults to `@eo/gateway`'s `probeConnectionReachability` (test-only escape hatch, mirroring `./connection-doctor.ts`'s own). */
  readonly probe?: (connection: ExternalConnection) => Promise<ReachabilityProbeResult>;
}

export interface JiraDatacenterConnectionDoctorResult {
  readonly ok: boolean;
  /** roadmap/19 §Exit criteria: "Basic-auth guard rejects without `allowBasicAuth: true` and accepts with it while emitting a non-blocking doctor finding." `true` only when `authMode: "basic"` AND the connection is otherwise healthy — never blocks `ok` by itself. */
  readonly basicAuthActive: boolean;
  readonly reachability?: ReachabilityProbeResult;
  readonly detail: string;
}

/**
 * Validates the configured auth mode can actually mint a usable header
 * (PAT/basic resolve; a disallowed basic-auth config, or an `authMode`
 * missing its required secret reference, fails here BEFORE the
 * reachability probe ever runs — pre-network, matching the guard's own
 * documented contract) and then probes reachability exactly as
 * `./connection-doctor.ts` does for Cloud.
 */
export async function runJiraDatacenterConnectionDoctor(
  input: JiraDatacenterConnectionDoctorInput,
): Promise<JiraDatacenterConnectionDoctorResult> {
  const { connection, config } = input;
  const probe = input.probe ?? probeConnectionReachability;

  let authHeaderProvider: ReturnType<typeof resolveJiraDatacenterAuthHeaderProvider>;
  try {
    authHeaderProvider = resolveJiraDatacenterAuthHeaderProvider(config);
  } catch (err) {
    return {
      ok: false,
      basicAuthActive: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await authHeaderProvider();
  } catch (err) {
    return {
      ok: false,
      basicAuthActive: config.authMode === "basic",
      detail: `auth-header resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const reachability = await probe(connection);
  if (!reachability.reachable) {
    return {
      ok: false,
      basicAuthActive: config.authMode === "basic",
      reachability,
      detail: `connection unreachable: ${reachability.detail}`,
    };
  }

  return {
    ok: true,
    basicAuthActive: config.authMode === "basic",
    reachability,
    detail:
      config.authMode === "basic"
        ? "reachable — basic auth is active for this connection (non-blocking finding: prefer PAT where possible)"
        : "reachable with a valid PAT",
  };
}

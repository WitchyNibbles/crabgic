/**
 * Connection-doctor reachability probe — roadmap/16-gateway-core.md
 * §Interfaces produced: "a primitive that exercises a stored connection
 * end-to-end (incl. custom-CA validation) without performing a mutating
 * call. Consumed by 18/19/20's own doctor-check functions... surfaced to
 * the human through 09's `connection doctor <id>`." Exit criterion:
 * "succeeds against a disposable fixture connection and fails
 * informatively against an unreachable one."
 *
 * Deliberately GET-only (never mutating) — reuses `../transport/http-
 * client.js`'s full security stack (SSRF guard, custom-CA-aware
 * `httpsAgent`, redirect revalidation) so a doctor probe is exercised
 * through the identical transport path a real read call would use, not a
 * bespoke shortcut.
 */

import type { ExternalConnection } from "@eo/contracts";
import { GatewayHttpClient, SsrfRefusedError } from "../transport/http-client.js";
import { resolveConnectionSecret } from "../connection-store/external-connection-store.js";

export interface ReachabilityProbeResult {
  readonly reachable: boolean;
  readonly status?: number;
  readonly detail: string;
}

export interface ReachabilityProbeOptions {
  /** Injectable client factory — production code builds a real `GatewayHttpClient`; tests inject one wired to a fake transport or a disposable HTTPS fixture server. */
  readonly buildClient?: (
    connection: ExternalConnection,
    customCaPem?: string,
  ) => GatewayHttpClient;
  readonly path?: string; // probe path, default "/"
}

function defaultBuildClient(
  connection: ExternalConnection,
  customCaPem: string | undefined,
): GatewayHttpClient {
  return new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: [new URL(connection.baseUrl).origin] },
    ...(customCaPem !== undefined ? { customCaPem } : {}),
  });
}

/**
 * Exercises `connection` end-to-end with a single, non-mutating GET,
 * including custom-CA validation when `connection.customCaRef` is set.
 * Never throws for an expected reachability failure — every outcome
 * (including a refused SSRF preflight, a TLS failure, or a timeout) is
 * reported as `{ reachable: false, detail }`, informative but never a
 * raw provider-body leak (message text only, never a response payload).
 */
export async function probeConnectionReachability(
  connection: ExternalConnection,
  options: ReachabilityProbeOptions = {},
): Promise<ReachabilityProbeResult> {
  let customCaPem: string | undefined;
  // Secret resolution failures are reported informatively too — a doctor
  // probe must never crash the CLI it backs.
  try {
    await resolveConnectionSecret(connection);
  } catch (err) {
    return {
      reachable: false,
      detail: `secret resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (connection.customCaRef !== undefined) {
    try {
      const { readFile } = await import("node:fs/promises");
      customCaPem = await readFile(connection.customCaRef.path, "utf8");
    } catch (err) {
      return {
        reachable: false,
        detail: `custom CA read failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const client = (options.buildClient ?? defaultBuildClient)(connection, customCaPem);
  const path = options.path ?? "/";

  try {
    const response = await client.request({
      connectionId: connection.id,
      tenant: "doctor-probe",
      resource: "reachability",
      url: new URL(path, connection.baseUrl),
      method: "GET",
    });
    return {
      reachable: response.status < 500,
      status: response.status,
      detail: `probe request completed with HTTP ${response.status}`,
    };
  } catch (err) {
    if (err instanceof SsrfRefusedError) {
      return { reachable: false, detail: `refused: ${err.message}` };
    }
    return {
      reachable: false,
      detail: `probe request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

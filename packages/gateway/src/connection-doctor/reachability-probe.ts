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

import type { ExternalConnection } from "@crabgic/contracts";
import {
  GatewayHttpClient,
  SsrfRefusedError,
  type GatewayHttpClientOptions,
} from "../transport/http-client.js";
import { buildAllowlistForConnection } from "../connection-store/connection-http-client.js";
import { resolveConnectionSecret } from "../connection-store/external-connection-store.js";

/**
 * The path probed when the caller names none. The SITE ROOT is the only
 * provider-neutral choice this module can make — which is exactly why it
 * cannot be the whole answer: on Atlassian Cloud an unauthenticated GET
 * of `/` redirects off-origin to `id.atlassian.com`, and the SSRF guard
 * refuses it before any credential could attach (issue #135, defect 1).
 * Provider-appropriate paths are supplied by the composition root through
 * `ReachabilityProbeOptions.path`; this package stays provider-agnostic.
 */
export const DEFAULT_PROBE_PATH = "/";

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

/**
 * The client `probeConnectionReachability` builds when no `buildClient`
 * override is supplied — EXPORTED so a test can exercise the production
 * allowlist rather than hand-rolling one beside it, which is precisely how
 * the defect below survived a green suite.
 *
 * The allowlist comes from `buildAllowlistForConnection`, the same
 * function every real call on this connection goes through. It did not,
 * once: this builder used `[new URL(connection.baseUrl).origin]` alone and
 * silently ignored `connection.allowedRedirectOrigins`, so `connection
 * add --allow-redirect` — the one knob the CLI exposes for a redirecting
 * host — could not affect the check it most looks like it should affect,
 * and `connection doctor` refused redirects the connector path allows
 * (issue #135, defect 1b). A doctor that guards differently from the call
 * path it is supposed to diagnose is worse than no doctor.
 *
 * `overrides` is a test-only escape hatch, mirroring
 * `buildHttpClientForConnection`'s own; production passes nothing.
 */
export function buildDoctorProbeClient(
  connection: ExternalConnection,
  customCaPem: string | undefined,
  overrides: Partial<GatewayHttpClientOptions> = {},
): GatewayHttpClient {
  return new GatewayHttpClient({
    allowlist: buildAllowlistForConnection(connection),
    ...(customCaPem !== undefined ? { customCaPem } : {}),
    ...overrides,
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

  const client = (options.buildClient ?? buildDoctorProbeClient)(connection, customCaPem);
  const path = options.path ?? DEFAULT_PROBE_PATH;

  try {
    const response = await client.request({
      connectionId: connection.id,
      tenant: "doctor-probe",
      resource: "reachability",
      url: new URL(path, connection.baseUrl),
      method: "GET",
    });
    // A 404 is NOT reachability. The probe requests a provider-chosen path
    // now (issue #135, defect 1), so "that path is not here" means the base
    // URL does not point at the service the operator said it does — a
    // finding worth reporting, not one to round up to success. An auth
    // challenge stays reachable: the probe deliberately attaches no
    // credential, so 401/403 is the expected answer from a healthy host.
    if (response.status === 404) {
      return {
        reachable: false,
        status: 404,
        detail:
          `probe path "${path}" returned HTTP 404 — the base URL may not point at ` +
          `this provider, or the provider's probe path has moved`,
      };
    }
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

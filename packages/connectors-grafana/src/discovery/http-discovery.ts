/**
 * The live half of Grafana capability discovery: a connection-scoped
 * sender, plus the `fetchBuildInfo`/`probeRoute` pair
 * `discoverGrafanaCapabilities` takes as dependencies.
 *
 * WHY IT EXISTS (issue #135, defect 3, Grafana half). Registering a
 * Grafana connection requires a live `CapabilitySnapshot` — the route
 * table is decoded from it — and nothing could produce one, so no Grafana
 * connection could ever be registered and every `observability.*` call
 * answered "was never registered".
 *
 * ────────────────────────────────────────────────────────────────────
 * ENGINE FACT, UNVERIFIED. Read this before trusting the mapping below.
 *
 * `./build-info-fixtures.ts` states plainly that its response shape "is
 * fixture data, not an assertion about Grafana's exact wire format ...
 * a deliberate approximation pending live verification". This module is
 * written against that approximation on an explicit owner ruling
 * (2026-08-14): build it, mark the fact unverified, rather than leave
 * Grafana undispatchable. It has NOT been run against a real Grafana.
 *
 * Two specific things are guesses, both isolated here so a single live
 * run can correct them without touching routing logic:
 *
 *  1. THE ENDPOINT. `GET /api/frontend/settings` is used because it is
 *     the documented response carrying BOTH `version` and `edition`.
 *     `/api/health` returns `{commit, database, version}` and no edition
 *     at all, and `CapabilitySnapshot` needs the edition.
 *  2. THE EDITION MAPPING. Grafana reports a display string ("Open
 *     Source"); `GrafanaBuildInfoResponseSchema` has a 3-member enum. The
 *     reconciliation lives in `normalizeGrafanaEdition` alone.
 *
 * Both fail CLOSED. An unrecognized edition, a missing `buildInfo`, or a
 * non-JSON body raises a typed error naming what was seen, rather than
 * defaulting to a value that would silently grant a known build's write
 * eligibility. When this is verified live, the fix is expected to be a
 * mapping/endpoint change here and nothing else — per roadmap/20's own
 * "the route table is data, not code".
 * ────────────────────────────────────────────────────────────────────
 */

import { ConnectorError, type ExternalConnection } from "@crabgic/contracts";
import { resolveConnectionSecret, type GatewayHttpClient } from "@crabgic/gateway";
import { GRAFANA_PROVIDER_NAME } from "../provider-registration.js";
import type { GrafanaResourceKind } from "../resource-kinds.js";
import type { GrafanaRawHttpResponse } from "../mutation/mutation-apply-client.js";
import { candidateBasePath } from "./route-table.js";
import type { GrafanaBuildInfoResponse, GrafanaRouteFamily } from "./build-info-fixtures.js";
import type { GrafanaDiscoveryDeps } from "./capability-discovery.js";

/** UNVERIFIED — see this module's header. The documented response carrying both version and edition. */
export const GRAFANA_BUILD_INFO_PATH = "/api/frontend/settings";

export type GrafanaSendSpec = { readonly method: string; readonly path: string };
export type GrafanaSend = (spec: GrafanaSendSpec) => Promise<GrafanaRawHttpResponse>;

export interface GrafanaSender {
  readonly send: GrafanaSend;
  /** GET-only, for the apply client's read-back/verify calls — the same SSRF-guarded transport as `send`, never a second one. */
  readonly get: (path: string) => Promise<GrafanaRawHttpResponse>;
}

function authenticationFailure(detail: string): ConnectorError {
  return ConnectorError.authentication({
    message: `Grafana discovery failed: ${detail}`,
    provider: GRAFANA_PROVIDER_NAME,
    retryable: false,
  });
}

/** The transport's closed verb set — an unknown method has no defined retry semantics, so it is refused rather than guessed at. */
const HTTP_VERBS = new Set(["GET", "PUT", "PATCH", "POST", "DELETE"]);

function asHttpVerb(method: string): "GET" | "PUT" | "PATCH" | "POST" | "DELETE" {
  const upper = method.toUpperCase();
  if (!HTTP_VERBS.has(upper)) {
    throw ConnectorError.validation({
      message: `Grafana sender was given an unsupported HTTP method "${method}"`,
      provider: GRAFANA_PROVIDER_NAME,
      retryable: false,
    });
  }
  return upper as "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
}

function validationFailure(detail: string): ConnectorError {
  return ConnectorError.validation({
    message: `Grafana discovery failed: ${detail}`,
    provider: GRAFANA_PROVIDER_NAME,
    retryable: false,
  });
}

/**
 * Builds the connection-scoped sender every Grafana call for this
 * connection goes through. The credential is resolved FRESH per request
 * and never held in this closure's state, so a rotated token is picked up
 * without re-registering the connection.
 */
export function buildGrafanaSender(
  connection: ExternalConnection,
  httpClient: GatewayHttpClient,
): GrafanaSender {
  const send: GrafanaSend = async ({ method, path }) => {
    // `RegisterGrafanaConnectionOptions.send` types its method as a bare
    // `string`, but the transport's retry ladder is defined over a closed
    // verb set — an unknown verb has no retry semantics, so it is refused
    // here rather than passed through and treated as some default.
    const verb = asHttpVerb(method);
    const token = await resolveConnectionSecret(connection);
    const response = await httpClient.request({
      connectionId: connection.id,
      // A pseudo-tenant used purely as the transport's concurrency key —
      // the same convention the doctor probe and Jira reads use.
      tenant: connection.id,
      resource: "grafana",
      url: new URL(path, connection.baseUrl),
      method: verb,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    return { status: response.status, headers: response.headers, bodyText: response.bodyText };
  };

  return { send, get: (path) => send({ method: "GET", path }) };
}

/**
 * Maps Grafana's reported edition onto `GrafanaBuildInfoResponse`'s closed
 * enum. `undefined` for anything unrecognized — the caller turns that into
 * a discovery failure rather than a default, because the edition feeds
 * `isKnownGrafanaBuild`, and guessing "oss" would hand an unknown build
 * the write eligibility a recognized one earns.
 */
export function normalizeGrafanaEdition(
  raw: string,
): GrafanaBuildInfoResponse["edition"] | undefined {
  switch (raw.trim().toLowerCase()) {
    case "open source":
    case "oss":
      return "oss";
    case "enterprise":
      return "enterprise";
    case "cloud":
      return "cloud";
    default:
      return undefined;
  }
}

/** A route that answers ANY of these is not present on this build. A 403 is included deliberately: a route this credential may not use is not a capability, whatever the remote can do for someone else. */
function isUnavailableStatus(status: number): boolean {
  return status === 404 || status === 403 || status === 501 || status >= 500;
}

/**
 * Builds the `fetchBuildInfo`/`probeRoute` pair
 * `discoverGrafanaCapabilities` consumes, over `send`.
 *
 * A 401 on EITHER call is propagated rather than absorbed. Absorbing it
 * would record a bad credential as a capability fact — "this Grafana
 * supports nothing" — which the snapshot cache would then hold for the
 * whole TTL.
 */
export function buildGrafanaDiscoveryDeps(send: GrafanaSend): GrafanaDiscoveryDeps {
  return {
    fetchBuildInfo: async (): Promise<GrafanaBuildInfoResponse> => {
      const response = await send({ method: "GET", path: GRAFANA_BUILD_INFO_PATH });
      if (response.status === 401) {
        throw authenticationFailure(`${GRAFANA_BUILD_INFO_PATH} rejected the connection's token`);
      }
      if (response.status >= 400) {
        throw validationFailure(
          `${GRAFANA_BUILD_INFO_PATH} responded with HTTP ${response.status}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.bodyText);
      } catch {
        throw validationFailure(`${GRAFANA_BUILD_INFO_PATH} returned a non-JSON body`);
      }

      const buildInfo = (parsed as { buildInfo?: unknown } | null)?.buildInfo as
        { version?: unknown; edition?: unknown } | undefined;
      if (typeof buildInfo !== "object" || buildInfo === null) {
        throw validationFailure(
          `${GRAFANA_BUILD_INFO_PATH} carried no buildInfo object — the endpoint may have moved`,
        );
      }
      if (typeof buildInfo.version !== "string" || buildInfo.version.length === 0) {
        throw validationFailure("buildInfo carried no version string");
      }
      if (typeof buildInfo.edition !== "string") {
        throw validationFailure("buildInfo carried no edition string");
      }

      const edition = normalizeGrafanaEdition(buildInfo.edition);
      if (edition === undefined) {
        // Named verbatim so the mapping above can be corrected against a
        // real observation rather than another guess.
        throw validationFailure(
          `buildInfo reported an unrecognized edition "${buildInfo.edition}" — ` +
            "extend normalizeGrafanaEdition once the real value is confirmed",
        );
      }

      return { product: "grafana", edition, version: buildInfo.version };
    },

    probeRoute: async (kind: GrafanaResourceKind, family: GrafanaRouteFamily) => {
      // GET only — discovery must never mutate, and the path comes from
      // the route table's own accessor so a probe and the resolved route
      // cannot disagree about where a kind lives.
      const response = await send({ method: "GET", path: candidateBasePath(kind, family) });
      if (response.status === 401) {
        throw authenticationFailure("route probe rejected the connection's token");
      }
      return !isUnavailableStatus(response.status);
    },
  };
}

import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type CapabilitySnapshot } from "@eo/contracts";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import {
  GrafanaBuildInfoResponseSchema,
  type GrafanaBuildInfoResponse,
  type GrafanaRouteFamily,
} from "./build-info-fixtures.js";
import {
  buildRouteTable,
  capabilityFlag,
  encodeRouteTableToApiFamilies,
  type CapabilityFlagSet,
} from "./route-table.js";

/** `major.minor` prefixes this phase has a recorded fixture for (roadmap/20 §In scope: "Compatibility fixtures: 11.6, 12.4, 13.1 + current Cloud"). Cloud is recognized by edition alone (its version string is a rolling tag, not a fixed number). */
const KNOWN_SELF_MANAGED_MAJOR_MINORS: ReadonlySet<string> = new Set(["11.6", "12.4", "13.1"]);

function majorMinorOf(version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match !== undefined && match !== null ? `${match[1]}.${match[2]}` : version;
}

/**
 * Whether `buildInfo` matches one of this phase's tested compatibility
 * fixtures. Cloud is always "known" (roadmap/20: "current Cloud" is itself
 * one of the 4 pinned targets, tracked continuously rather than pinned to a
 * fixed version number, since Cloud exposes no stable version an operator
 * could pin against in the first place); OSS/Enterprise are known only at
 * the exact pinned `major.minor` — anything else (older, newer, or an
 * edition/version combination never fixture-verified) is unknown.
 *
 * Adversarial-review LOW finding: this function receives `buildInfo` only
 * AFTER `discoverGrafanaCapabilities` has already validated it against
 * `GrafanaBuildInfoResponseSchema` — `edition: "cloud"` is therefore
 * guaranteed to be a well-formed, schema-conforming claim (one of exactly
 * 3 enum members), not an arbitrary unchecked string; the unconditional
 * cloud→known bypass is a deliberate, documented design decision (Cloud is
 * genuinely one of this phase's 4 pinned targets), not a validation gap.
 * `version` is still recorded verbatim on the returned snapshot either way
 * — Cloud bypassing the major.minor ALLOWLIST never means its version goes
 * unrecorded.
 */
export function isKnownGrafanaBuild(buildInfo: GrafanaBuildInfoResponse): boolean {
  if (buildInfo.edition === "cloud") return true;
  return KNOWN_SELF_MANAGED_MAJOR_MINORS.has(majorMinorOf(buildInfo.version));
}

export interface GrafanaDiscoveryDeps {
  /** Performs the health/build-info call — production calls the real `GET /api/health`-equivalent endpoint; tests inject a fixture response. */
  readonly fetchBuildInfo: () => Promise<GrafanaBuildInfoResponse>;
  /** Route probing — production issues one non-mutating request per (kind, family) candidate route and reports whether it answered as available; tests inject a scripted fixture. */
  readonly probeRoute: (kind: GrafanaResourceKind, family: GrafanaRouteFamily) => Promise<boolean>;
}

export interface GrafanaDiscoveryResult {
  readonly product: "grafana";
  readonly edition: GrafanaBuildInfoResponse["edition"];
  readonly version: string;
  readonly apiFamilies: readonly string[];
  readonly resources: readonly string[];
  readonly actions: readonly string[];
  readonly permissions: readonly string[];
  readonly isReadOnly: boolean;
}

/**
 * Discovers a Grafana connection's capabilities — roadmap/20 §In scope,
 * "Version-aware routing": build-info call + route probing, unknown build
 * forced read-only. Shaped to plug directly into
 * `@eo/gateway`'s `DiscoverCapabilitySnapshot` (`(connectionId) =>
 * Promise<Omit<CapabilitySnapshot, "discoveredAt" | "expiresAt">>`) — the
 * caller (16's `CapabilitySnapshotCache`) adds `discoveredAt`/`expiresAt`
 * and the `id`/`externalConnectionId`/`schemaVersion` envelope fields.
 */
export async function discoverGrafanaCapabilities(
  deps: GrafanaDiscoveryDeps,
): Promise<GrafanaDiscoveryResult> {
  // Adversarial-review LOW fix: "never trust external shape" — this is the
  // boundary where an arbitrary build-info response first enters this
  // package; a malformed shape (missing `version`, an `edition` outside
  // the 3-member enum, etc.) now fails discovery outright via zod, rather
  // than silently proceeding with `undefined`/wrong-shaped fields that
  // `isKnownGrafanaBuild`/`majorMinorOf` would otherwise tolerate.
  const buildInfo = GrafanaBuildInfoResponseSchema.parse(await deps.fetchBuildInfo());
  const known = isKnownGrafanaBuild(buildInfo);

  const flags: Set<string> = new Set();
  for (const kind of GRAFANA_RESOURCE_KINDS) {
    for (const family of ["apis", "legacy"] as const) {
      const available = await deps.probeRoute(kind, family);
      if (available) flags.add(capabilityFlag(kind, family));
    }
  }
  const flagSet: CapabilityFlagSet = flags;
  const routeTable = buildRouteTable(flagSet);
  const resources = Object.keys(routeTable);

  // Defense in depth: even if every route happens to probe as reachable,
  // an unrecognized build never earns write eligibility (roadmap/20 exit
  // criterion: "An unknown/untested build-info fixture forces a read-only
  // CapabilitySnapshot").
  const isReadOnly = !known;

  return {
    product: "grafana",
    edition: buildInfo.edition,
    version: buildInfo.version,
    apiFamilies: encodeRouteTableToApiFamilies(routeTable),
    resources,
    actions: isReadOnly ? ["list", "get"] : ["list", "get", "create", "update"],
    permissions: isReadOnly ? ["read"] : ["read", "write"],
    isReadOnly,
  };
}

/**
 * Adapts `discoverGrafanaCapabilities`'s result to `@eo/gateway`'s
 * `DiscoverCapabilitySnapshot` shape (`(connectionId) =>
 * Promise<Omit<CapabilitySnapshot, "discoveredAt" | "expiresAt">>`) — the
 * exact function `CapabilitySnapshotCache`'s constructor expects, so the
 * gateway's own 15-minute cache/invalidation policy applies unchanged to
 * every Grafana connection.
 */
export function buildGrafanaCapabilitySnapshotDiscoverer(
  buildDeps: (connectionId: string) => GrafanaDiscoveryDeps,
): (connectionId: string) => Promise<Omit<CapabilitySnapshot, "discoveredAt" | "expiresAt">> {
  return async (connectionId) => {
    const result = await discoverGrafanaCapabilities(buildDeps(connectionId));
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      externalConnectionId: connectionId,
      product: result.product,
      edition: result.edition,
      version: result.version,
      apiFamilies: result.apiFamilies,
      resources: result.resources,
      actions: result.actions,
      permissions: result.permissions,
      isReadOnly: result.isReadOnly,
    };
  };
}

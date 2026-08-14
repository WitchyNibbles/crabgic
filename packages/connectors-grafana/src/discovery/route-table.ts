import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";
import { getResourceDefinition } from "../resources/definitions/index.js";
import {
  resolveDefinitionForFamily,
  supportsApisFamily,
  type GrafanaResourceDefinition,
} from "../resources/resource-definitions.js";
import type { GrafanaRouteFamily } from "./build-info-fixtures.js";

/** The base path each (kind, family) resolves to — data, not code (roadmap/20 §Risks: "the route table is data ... drift lands as a fixture update, never a routing-logic change"). */
const FAMILY_BASE_PATHS: Readonly<
  Record<GrafanaResourceKind, Readonly<Record<GrafanaRouteFamily, string>>>
> = {
  folder: {
    legacy: "/api/folders",
    apis: "/apis/folder.grafana.app/v1beta1/namespaces/default/folders",
  },
  dashboard: {
    legacy: "/api/dashboards",
    apis: "/apis/dashboard.grafana.app/v1beta1/namespaces/default/dashboards",
  },
  annotation: {
    legacy: "/api/annotations",
    apis: "/apis/annotation.grafana.app/v0alpha1/namespaces/default/annotations",
  },
  "alert-rule": {
    legacy: "/api/v1/provisioning/alert-rules",
    apis: "/apis/notifications.alerting.grafana.app/v0alpha1/namespaces/default/alertrules",
  },
  "contact-point": {
    legacy: "/api/v1/provisioning/contact-points",
    apis: "/apis/notifications.alerting.grafana.app/v0alpha1/namespaces/default/receivers",
  },
  "mute-timing": {
    legacy: "/api/v1/provisioning/mute-timings",
    apis: "/apis/notifications.alerting.grafana.app/v0alpha1/namespaces/default/timeintervals",
  },
  "notification-template": {
    legacy: "/api/v1/provisioning/templates",
    apis: "/apis/notifications.alerting.grafana.app/v0alpha1/namespaces/default/templategroups",
  },
};

/** A capability-flag set observed via route probing — one `"<kind>:<family>"` token per (kind, family) that answered as available. Deliberately a `Set` (order-independent) — never a version string. */
export type CapabilityFlagSet = ReadonlySet<string>;

export function capabilityFlag(kind: GrafanaResourceKind, family: GrafanaRouteFamily): string {
  return `${kind}:${family}`;
}

export interface RouteTableEntry {
  readonly kind: GrafanaResourceKind;
  readonly family: GrafanaRouteFamily;
  readonly basePath: string;
}

/** `RouteTable` — one resolved entry per resource kind that has ANY available family; a kind with no available family is simply absent (unsupported this build). */
export type RouteTable = Readonly<Partial<Record<GrafanaResourceKind, RouteTableEntry>>>;

/**
 * Selects the route family for `kind` from `flags` alone — never from a
 * version string (roadmap/20 §In scope: "by capability, not major
 * version"). Prefers the newer `apis` family when both are available;
 * falls back to `legacy`; returns `undefined` when neither responded
 * (this build doesn't support `kind` at all). Purely a function of the
 * capability-flag SET — insertion order and duplicate insertions never
 * change the result (proven by `route-table.test.ts`'s property test).
 */
export function selectRouteFamily(
  kind: GrafanaResourceKind,
  flags: CapabilityFlagSet,
): GrafanaRouteFamily | undefined {
  // "Advertised" is necessary but NOT sufficient — the connector must also
  // be able to SPEAK the family. This second condition was missing, and its
  // absence was the defect: `apis` was selected for every kind a build
  // advertised it for, while no resource definition could build an
  // App Platform request, so the classic path fragment and body went to the
  // Kubernetes-style base path and every write failed on the wire. Falling
  // back to `legacy` for a kind we cannot speak is correct and lossless —
  // Grafana keeps serving the classic API alongside the new one.
  if (flags.has(capabilityFlag(kind, "apis")) && connectorSpeaksApis(kind)) return "apis";
  if (flags.has(capabilityFlag(kind, "legacy"))) return "legacy";
  // A kind advertised ONLY on a family this connector cannot speak is
  // unsupported on this build, and saying so is better than routing it
  // somewhere it will fail: `buildRouteTable` omits the kind entirely, and
  // `requireBasePath` raises "no route available for Grafana resource kind".
  return undefined;
}

/**
 * The base path a (kind, family) pair resolves to, BEFORE any probing has
 * decided whether that route exists on this build.
 *
 * Exported for the route PROBER (`./http-discovery.ts`), which must know
 * the candidate path in order to ask whether it answers. Reading
 * `FAMILY_BASE_PATHS` through this accessor keeps the table itself
 * private, so the probe and the resolved route table cannot disagree
 * about where a kind lives — they read one source.
 */
export function candidateBasePath(kind: GrafanaResourceKind, family: GrafanaRouteFamily): string {
  return FAMILY_BASE_PATHS[kind][family];
}

/** Whether a resource definition for `kind` carries App Platform behaviour. */
function connectorSpeaksApis(kind: GrafanaResourceKind): boolean {
  return supportsApisFamily(getResourceDefinition(kind));
}

/** Builds the full `RouteTable` from a capability-flag set — the data-driven route table roadmap/20 names as a `CapabilitySnapshot`-scoped interface produced. */
export function buildRouteTable(flags: CapabilityFlagSet): RouteTable {
  const table: Record<string, RouteTableEntry> = {};
  for (const kind of GRAFANA_RESOURCE_KINDS) {
    const family = selectRouteFamily(kind, flags);
    if (family === undefined) continue;
    table[kind] = { kind, family, basePath: FAMILY_BASE_PATHS[kind][family] };
  }
  return table;
}

/** Encodes a `RouteTable` into `CapabilitySnapshot.apiFamilies`'s flat string-array shape — `"<kind>:<family>"` per resolved entry, the serialized form this phase's `CapabilitySnapshot` instances carry. */
export function encodeRouteTableToApiFamilies(table: RouteTable): readonly string[] {
  return Object.values(table)
    .filter((entry): entry is RouteTableEntry => entry !== undefined)
    .map((entry) => capabilityFlag(entry.kind, entry.family));
}

/** Decodes `CapabilitySnapshot.apiFamilies` back into a `RouteTable` — the inverse of `encodeRouteTableToApiFamilies`, used by resource clients to resolve a kind's base path from an already-discovered snapshot without re-probing. */
export function decodeApiFamiliesToRouteTable(apiFamilies: readonly string[]): RouteTable {
  const table: Record<string, RouteTableEntry> = {};
  for (const token of apiFamilies) {
    const [kindRaw, familyRaw] = token.split(":");
    if (kindRaw === undefined || familyRaw === undefined) continue;
    if (!(GRAFANA_RESOURCE_KINDS as readonly string[]).includes(kindRaw)) continue;
    if (familyRaw !== "legacy" && familyRaw !== "apis") continue;
    const kind = kindRaw as GrafanaResourceKind;
    table[kind] = { kind, family: familyRaw, basePath: FAMILY_BASE_PATHS[kind][familyRaw] };
  }
  return table;
}

/**
 * Resolves both halves of "how do I talk to this kind on this connection":
 * the base path, and the resource behaviour matching the family that base
 * path belongs to.
 *
 * The two must be chosen together. Handing a caller a base path without the
 * matching behaviour is exactly how classic request shapes ended up on
 * App Platform endpoints — the base path came from the route table and the
 * builders came from `getResourceDefinition`, and nothing tied them to the
 * same family. Callers now take both from here, so they cannot drift.
 */
export function resolveRouteForKind(
  routeTable: RouteTable,
  kind: GrafanaResourceKind,
): { readonly basePath: string; readonly definition: GrafanaResourceDefinition } {
  const entry = routeTable[kind];
  if (entry === undefined) {
    throw new Error(`no route available for Grafana resource kind "${kind}" on this connection`);
  }
  return {
    basePath: entry.basePath,
    definition: resolveDefinitionForFamily(getResourceDefinition(kind), entry.family),
  };
}

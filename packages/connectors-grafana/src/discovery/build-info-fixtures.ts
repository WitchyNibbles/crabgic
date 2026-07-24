import { z } from "zod";
import { GRAFANA_RESOURCE_KINDS, type GrafanaResourceKind } from "../resource-kinds.js";

/**
 * A Grafana health/build-info response — roadmap/20-grafana-adapters.md §In
 * scope, "Version-aware routing: live discovery (health/build-info call +
 * route probing)." Modeled on `GET /api/health`'s `{ commit, database,
 * version }` shape plus the product/edition split every downstream
 * `CapabilitySnapshot` field needs. This shape is fixture data, not an
 * assertion about Grafana's exact wire format — the route table itself is
 * "data, not code" (roadmap/20 §Risks), so a real-world drift is a fixture
 * update, never a routing-logic change (`docs/evidence/phase-20/` records
 * this as a deliberate approximation pending live verification).
 *
 * `GrafanaBuildInfoResponseSchema` (adversarial-review LOW fix) is the
 * boundary validator `../discovery/capability-discovery.ts` applies to
 * whatever `fetchBuildInfo()` returns — this is the one external response
 * shape in this package that was previously trusted without validation
 * ("never trust external shape," this repo's own coding-style rule,
 * contrast `../provider-registration.ts`'s already-strict zod validation
 * of every `observability.*` tool-call param). A malformed/self-reported
 * shape (missing `version`, an `edition` outside the 3-member enum, etc.)
 * now fails discovery outright rather than silently proceeding.
 */
export const GrafanaBuildInfoResponseSchema = z
  .object({
    product: z.literal("grafana"),
    edition: z.enum(["oss", "enterprise", "cloud"]),
    version: z.string().min(1),
  })
  .strict();

export type GrafanaBuildInfoResponse = z.infer<typeof GrafanaBuildInfoResponseSchema>;

export type GrafanaRouteFamily = "legacy" | "apis";

/** One route-probe fixture: which (kind, family) combinations respond as "available" for this pinned build. */
export type RouteAvailability = Readonly<
  Record<GrafanaResourceKind, readonly GrafanaRouteFamily[]>
>;

export interface GrafanaBuildInfoFixture {
  readonly fixtureLabel: string;
  readonly buildInfo: GrafanaBuildInfoResponse;
  readonly routeAvailability: RouteAvailability;
}

function allKindsLegacyOnly(): RouteAvailability {
  const table = {} as Record<GrafanaResourceKind, readonly GrafanaRouteFamily[]>;
  for (const kind of GRAFANA_RESOURCE_KINDS) {
    table[kind] = ["legacy"];
  }
  return table;
}

function withApisFor(
  base: RouteAvailability,
  kinds: readonly GrafanaResourceKind[],
): RouteAvailability {
  const next = { ...base };
  for (const kind of kinds) {
    next[kind] = ["legacy", "apis"];
  }
  return next;
}

/** 11.6 — earliest pinned OSS fixture; every resource kind is legacy-`/api`-only. */
export const BUILD_INFO_OSS_11_6: GrafanaBuildInfoFixture = {
  fixtureLabel: "grafana-oss-11.6",
  buildInfo: { product: "grafana", edition: "oss", version: "11.6.2" },
  routeAvailability: allKindsLegacyOnly(),
};

/** 12.4 — folder/dashboard have gained an `/apis` route; alerting resources remain legacy-only. */
export const BUILD_INFO_OSS_12_4: GrafanaBuildInfoFixture = {
  fixtureLabel: "grafana-oss-12.4",
  buildInfo: { product: "grafana", edition: "oss", version: "12.4.1" },
  routeAvailability: withApisFor(allKindsLegacyOnly(), ["folder", "dashboard"]),
};

/** 13.1 — annotation joins folder/dashboard on `/apis`; alerting resources remain legacy-only. */
export const BUILD_INFO_OSS_13_1: GrafanaBuildInfoFixture = {
  fixtureLabel: "grafana-oss-13.1",
  buildInfo: { product: "grafana", edition: "oss", version: "13.1.0" },
  routeAvailability: withApisFor(allKindsLegacyOnly(), ["folder", "dashboard", "annotation"]),
};

/** Current Cloud — broadest `/apis` coverage; legacy routes still answer as a fallback (Cloud runs the newest rollout). */
export const BUILD_INFO_CLOUD_CURRENT: GrafanaBuildInfoFixture = {
  fixtureLabel: "grafana-cloud-current",
  buildInfo: { product: "grafana", edition: "cloud", version: "cloud-rolling" },
  routeAvailability: withApisFor(allKindsLegacyOnly(), ["folder", "dashboard", "annotation"]),
};

/** Enterprise — same route shape as 13.1 OSS (enterprise builds track the OSS core's API surface); distinct fixture so Enterprise's own Docker-recipe run has its own build-info to discover against (roadmap/20 §Test plan: "Docker-recipe-backed OSS/Enterprise runs"). */
export const BUILD_INFO_ENTERPRISE_CURRENT: GrafanaBuildInfoFixture = {
  fixtureLabel: "grafana-enterprise-13.1",
  buildInfo: { product: "grafana", edition: "enterprise", version: "13.1.0" },
  routeAvailability: withApisFor(allKindsLegacyOnly(), ["folder", "dashboard", "annotation"]),
};

/** An unrecognized/untested build — roadmap/20 exit criteria: "An unknown/untested build-info fixture forces a read-only `CapabilitySnapshot`." Routes still probe as reachable (legacy everywhere) — the read-only verdict comes from the version being unrecognized, never from route availability alone (defense in depth). */
export const BUILD_INFO_UNKNOWN: GrafanaBuildInfoFixture = {
  fixtureLabel: "grafana-unknown-build",
  buildInfo: { product: "grafana", edition: "oss", version: "9.0.7" },
  routeAvailability: allKindsLegacyOnly(),
};

export const PINNED_BUILD_INFO_FIXTURES: readonly GrafanaBuildInfoFixture[] = [
  BUILD_INFO_OSS_11_6,
  BUILD_INFO_OSS_12_4,
  BUILD_INFO_OSS_13_1,
  BUILD_INFO_CLOUD_CURRENT,
];

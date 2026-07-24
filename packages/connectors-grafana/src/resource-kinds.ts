import type { HighImpactCapabilityFlag } from "@eo/contracts";

/**
 * The 7 Grafana resource kinds this phase's `GrafanaProviderAdapter`
 * exposes list/get/create/update for (roadmap/20-grafana-adapters.md §In
 * scope, "Resources (list/get/create/update only)"). Deliberately a closed,
 * exhaustive list — no delete/admin kind is ever added here; adding a
 * delete path for any of these kinds is out of scope permanently (§In
 * scope, "Excluded, permanently").
 */
export const GRAFANA_RESOURCE_KINDS = [
  "folder",
  "dashboard",
  "annotation",
  "alert-rule",
  "contact-point",
  "mute-timing",
  "notification-template",
] as const;

export type GrafanaResourceKind = (typeof GRAFANA_RESOURCE_KINDS)[number];

export function isGrafanaResourceKind(value: unknown): value is GrafanaResourceKind {
  return typeof value === "string" && (GRAFANA_RESOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Static high-impact-flag table — roadmap/20 §In scope, "High-impact
 * flags": "alert disabling, contact points, mute timings, notification
 * templates — each envelope-required, using 02's `HighImpactCapabilityFlag`
 * labels verbatim." Keyed by resource kind; `alert-rule`'s flag applies
 * only to its disabling mutation specifically (see
 * `./mutation/high-impact-tagging.ts`), the other three kinds' flags apply
 * to every create/update on that kind. Folder/dashboard/annotation carry no
 * high-impact flag — deliberately absent from this table (an absent key
 * means "no flag required for this kind").
 */
export const HIGH_IMPACT_FLAG_BY_KIND: Readonly<
  Partial<Record<GrafanaResourceKind, HighImpactCapabilityFlag>>
> = {
  "alert-rule": "alert disabling",
  "contact-point": "contact points",
  "mute-timing": "mute timings",
  "notification-template": "notification templates",
};

/** The 4 Grafana-relevant `HighImpactCapabilityFlag` members, verbatim (roadmap/20 §In scope). */
export const GRAFANA_HIGH_IMPACT_FLAGS: readonly HighImpactCapabilityFlag[] = [
  "alert disabling",
  "contact points",
  "mute timings",
  "notification templates",
];

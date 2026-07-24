/**
 * Grafana connection-doctor check — roadmap/20-grafana-adapters.md §In
 * scope, "Auth": "a connection-doctor check validates token scope + org
 * binding before first use." Distinct from `@eo/gateway`'s
 * `probeConnectionReachability` (a provider-agnostic GET-only reachability
 * probe): this check is Grafana-specific — it inspects the AUTHENTICATED
 * identity a service-account token resolves to (its org + role) and
 * verifies that identity is actually within this connection's declared
 * org allowlist, never merely that the endpoint answered HTTP 200.
 *
 * Deliberately never receives the token/secret value itself — only an
 * already-authenticated `fetchTokenInfo` callback the caller wires up
 * (via `@eo/gateway`'s secret-reference resolver + HTTP client). No
 * credential material is constructible from this module's own inputs.
 */

export interface GrafanaTokenInfoResponse {
  readonly orgId: number;
  /** The service-account/token's Grafana role — "Viewer" | "Editor" | "Admin" (Grafana's own RBAC basic-role vocabulary). */
  readonly role: string;
}

type GrafanaRole = "Viewer" | "Editor" | "Admin";
const ROLE_RANK: Readonly<Record<GrafanaRole, number>> = { Viewer: 0, Editor: 1, Admin: 2 };

function isGrafanaRole(value: string): value is GrafanaRole {
  return value === "Viewer" || value === "Editor" || value === "Admin";
}

export interface GrafanaDoctorDeps {
  /** Resolves the token's own identity — production calls Grafana's token-info endpoint through an already-authenticated client; tests inject a fixture response. */
  readonly fetchTokenInfo: () => Promise<GrafanaTokenInfoResponse>;
  /** `ExternalConnection.orgAllowlist`, stringified — the org(s) this connection is scoped to. */
  readonly orgAllowlist: readonly string[];
  /** Minimum required role for this connection's intended use (defaults to "Editor" — the minimum role able to create/update the 7 resource kinds). */
  readonly minimumRole?: "Viewer" | "Editor" | "Admin";
}

export type GrafanaDoctorResult =
  | { readonly ok: true; readonly orgId: number; readonly role: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Validates token scope + org binding. Never throws for an expected
 * failure (a doctor check must always report, never crash its caller) —
 * only an unexpected programming error propagates. Never echoes any
 * response field beyond `orgId`/`role`, so a raw provider body can never
 * leak through this function's return value.
 */
export async function checkGrafanaConnectionDoctor(
  deps: GrafanaDoctorDeps,
): Promise<GrafanaDoctorResult> {
  let tokenInfo: GrafanaTokenInfoResponse;
  try {
    tokenInfo = await deps.fetchTokenInfo();
  } catch (err) {
    return {
      ok: false,
      reason: `token-info request failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  if (deps.orgAllowlist.length === 0) {
    return { ok: false, reason: "connection has an empty org allowlist — refusing to proceed" };
  }
  const orgIdStr = String(tokenInfo.orgId);
  if (!deps.orgAllowlist.includes(orgIdStr)) {
    return {
      ok: false,
      reason: `token is bound to org ${orgIdStr}, which is outside this connection's org allowlist`,
    };
  }

  const minimumRole = deps.minimumRole ?? "Editor";
  if (!isGrafanaRole(tokenInfo.role)) {
    return { ok: false, reason: `token role "${tokenInfo.role}" is not a recognized Grafana role` };
  }
  const actualRank = ROLE_RANK[tokenInfo.role];
  const requiredRank = ROLE_RANK[minimumRole];
  if (actualRank < requiredRank) {
    return {
      ok: false,
      reason: `token role "${tokenInfo.role}" does not meet the required minimum "${minimumRole}"`,
    };
  }

  return { ok: true, orgId: tokenInfo.orgId, role: tokenInfo.role };
}

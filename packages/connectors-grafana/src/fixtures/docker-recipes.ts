/**
 * OSS/Enterprise Docker recipes — roadmap/20-grafana-adapters.md work item
 * 6: "OSS/Enterprise Docker recipes for 23" (the live E2E matrix runner
 * phase 23 owns). This package supplies the RECIPE as reviewable,
 * versioned data — never a live container — matching this repo's ground
 * rule against live network calls in tests. `docs/evidence/phase-20/`
 * records this scope decision: an actual Docker-backed run is 23's own
 * infrastructure concern; this phase's own "Docker-recipe-backed
 * OSS/Enterprise runs" test-plan bullet is satisfied here by replaying the
 * SAME cassette mechanism (`./cassettes.js`) against the build-info fixture
 * each recipe's container is expected to report at discovery time — never
 * a fabricated claim that a live container was actually started.
 */
export interface GrafanaDockerRecipe {
  readonly label: "oss" | "enterprise";
  /** The pinned image tag this recipe starts — a specific, reproducible version, never `:latest`. */
  readonly image: string;
  /** Non-secret bootstrap environment only — no admin password, no API key. A real deployment supplies credentials via `GF_SECURITY_ADMIN_PASSWORD__FILE`-style file-based env (never a literal in this recipe). */
  readonly env: Readonly<Record<string, string>>;
  readonly ports: readonly number[];
  /** Cross-reference to the `GrafanaBuildInfoFixture.fixtureLabel` this recipe's Grafana instance is expected to report once running. */
  readonly buildInfoFixtureLabel: string;
}

export const OSS_DOCKER_RECIPE: GrafanaDockerRecipe = {
  label: "oss",
  image: "grafana/grafana-oss:13.1.0",
  env: {
    GF_AUTH_DISABLE_LOGIN_FORM: "false",
    GF_SECURITY_ADMIN_PASSWORD__FILE: "/run/secrets/grafana-admin-password",
    GF_FEATURE_TOGGLES_ENABLE: "kubernetesFolders,kubernetesDashboards",
  },
  ports: [3000],
  buildInfoFixtureLabel: "grafana-oss-13.1",
};

export const ENTERPRISE_DOCKER_RECIPE: GrafanaDockerRecipe = {
  label: "enterprise",
  image: "grafana/grafana-enterprise:13.1.0",
  env: {
    GF_AUTH_DISABLE_LOGIN_FORM: "false",
    GF_SECURITY_ADMIN_PASSWORD__FILE: "/run/secrets/grafana-admin-password",
    GF_ENTERPRISE_LICENSE_PATH: "/run/secrets/grafana-enterprise-license",
    GF_FEATURE_TOGGLES_ENABLE: "kubernetesFolders,kubernetesDashboards",
  },
  ports: [3000],
  buildInfoFixtureLabel: "grafana-enterprise-13.1",
};

export const GRAFANA_DOCKER_RECIPES: readonly GrafanaDockerRecipe[] = [
  OSS_DOCKER_RECIPE,
  ENTERPRISE_DOCKER_RECIPE,
];

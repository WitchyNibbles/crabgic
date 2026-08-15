import { describe, expect, it } from "vitest";
import { JIRA_CLOUD_PROVIDER_KEY, JIRA_DATACENTER_PROVIDER_KEY } from "@crabgic/connectors-jira";
import { GRAFANA_PROVIDER_NAME } from "@crabgic/connectors-grafana";
import { DEFAULT_PROBE_PATH } from "@crabgic/gateway";
import { resolveProbePath } from "./probe-paths.js";

/**
 * Issue #135, defect 1. `connection doctor` GET `/`, and on Atlassian
 * Cloud that redirects off-origin to `id.atlassian.com`, so the SSRF
 * guard refused every Jira Cloud connection before anything else ran.
 * The path seam existed on `probeConnectionReachability` all along and
 * had NO production caller — these tests are that caller.
 */
describe("resolveProbePath", () => {
  it("gives Jira Cloud the connector's own non-redirecting probe path", () => {
    expect(resolveProbePath(JIRA_CLOUD_PROVIDER_KEY)).toBe("/status");
  });

  it("leaves Jira Data Center on the neutral default — no DC evidence was gathered", () => {
    expect(resolveProbePath(JIRA_DATACENTER_PROVIDER_KEY)).toBeUndefined();
  });

  it("leaves Grafana on the neutral default, which already works for it", () => {
    expect(resolveProbePath(GRAFANA_PROVIDER_NAME)).toBeUndefined();
  });

  it("leaves an unknown provider on the neutral default rather than guessing a path", () => {
    expect(resolveProbePath("servicenow")).toBeUndefined();
  });

  it("leaves the legacy pre-migration provider value on the default", () => {
    // Records are migrated on read before they reach the probe; if one ever
    // arrives un-migrated, the neutral default is the safe answer.
    expect(resolveProbePath("jira")).toBeUndefined();
  });

  it("never returns the neutral default as an explicit value", () => {
    // Returning "/" explicitly would silently claim a provider had been
    // considered and assigned the root, which is not the same statement as
    // "no provider-specific path is known".
    for (const provider of [JIRA_CLOUD_PROVIDER_KEY, GRAFANA_PROVIDER_NAME, "unknown"]) {
      expect(resolveProbePath(provider)).not.toBe(DEFAULT_PROBE_PATH);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  buildPinnedFixtureSnapshots,
  PINNED_GRAFANA_VERSION,
  PINNED_JIRA_VERSION,
} from "./pinned-fixtures.js";
import { compareDriftFixture } from "./drift-proposal.js";

describe("buildPinnedFixtureSnapshots", () => {
  it("with no observed override, every snapshot's observed == pinned (no drift)", () => {
    const snapshots = buildPinnedFixtureSnapshots();
    for (const snapshot of snapshots) {
      expect(compareDriftFixture(snapshot).drifted).toBe(false);
    }
  });

  it("an observed override for jira only affects the jira snapshot", () => {
    const snapshots = buildPinnedFixtureSnapshots({
      jira: { version: "1001.0.0" },
    });
    const jira = snapshots.find((s) => s.connector === "jira");
    const grafana = snapshots.find((s) => s.connector === "grafana");
    expect(jira?.observedVersion).toBe("1001.0.0");
    expect(jira?.pinnedVersion).toBe(PINNED_JIRA_VERSION);
    expect(grafana?.observedVersion).toBe(PINNED_GRAFANA_VERSION);
    expect(compareDriftFixture(jira!).drifted).toBe(true);
    expect(compareDriftFixture(grafana!).drifted).toBe(false);
  });
});

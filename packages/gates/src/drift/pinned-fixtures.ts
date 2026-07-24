import type { DriftFixtureSnapshot } from "./drift-proposal.js";

/**
 * The drift-CI job's pinned-fixture baseline — roadmap/21 work item 5:
 * "scheduled replay of 18/20 cassettes against live/sandbox endpoints."
 *
 * FIXTURE-MODELED, NOT LIVE (documented honestly per docs/evidence/
 * phase-21/README.md, matching phase 19/20's own precedent): this
 * environment has no live Jira Cloud / Grafana sandbox to replay against
 * (roadmap/21 §Risks: "Live sandbox availability for the drift job depends
 * on the disposable environments 18/20 provision for phase 23"). The
 * `observedVersion`/`observedShape` half of each snapshot below is read
 * from an environment variable the real scheduled job (once 18/20/23's
 * sandboxes exist) would populate from an actual live probe; absent that
 * env var, it defaults to the pinned value — i.e. "no observation available
 * yet" reads as "no drift detected" rather than a false positive.
 */
export const PINNED_JIRA_VERSION = "1000.0.0";
export const PINNED_GRAFANA_VERSION = "13.1.0";

const PINNED_JIRA_SHAPE = {
  summary: "string",
  description: "string",
  status: "string",
  assignee: "string",
} as const;

const PINNED_GRAFANA_SHAPE = {
  uid: "string",
  title: "string",
  version: "number",
  folderUid: "string",
} as const;

export interface ObservedOverride {
  readonly version?: string;
  readonly shape?: Readonly<Record<string, unknown>>;
}

export function buildPinnedFixtureSnapshots(
  observed: { readonly jira?: ObservedOverride; readonly grafana?: ObservedOverride } = {},
): readonly DriftFixtureSnapshot[] {
  return [
    {
      connector: "jira",
      pinnedVersion: PINNED_JIRA_VERSION,
      observedVersion: observed.jira?.version ?? PINNED_JIRA_VERSION,
      pinnedShape: PINNED_JIRA_SHAPE,
      observedShape: observed.jira?.shape ?? PINNED_JIRA_SHAPE,
    },
    {
      connector: "grafana",
      pinnedVersion: PINNED_GRAFANA_VERSION,
      observedVersion: observed.grafana?.version ?? PINNED_GRAFANA_VERSION,
      pinnedShape: PINNED_GRAFANA_SHAPE,
      observedShape: observed.grafana?.shape ?? PINNED_GRAFANA_SHAPE,
    },
  ];
}

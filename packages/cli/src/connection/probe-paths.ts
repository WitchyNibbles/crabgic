/**
 * Maps a connection's provider-dispatch key to the path `connection
 * doctor` should probe — the composition root's job, because it is the
 * only layer that knows both `@crabgic/gateway`'s provider-agnostic probe
 * and the connectors' provider-specific facts.
 *
 * `probeConnectionReachability` deliberately keeps no provider table of
 * its own: a gateway that knew Atlassian's URL layout would be a gateway
 * every future connector had to edit. Its `path` option existed for
 * exactly this and had no production caller at all until issue #135
 * showed what the missing caller cost — `connection doctor` reporting
 * UNREACHABLE for every healthy Atlassian Cloud site.
 *
 * `undefined` means "no provider-specific path is known, use the neutral
 * default", which is a different statement from "the root is correct for
 * this provider" — hence the absent value rather than a returned `"/"`.
 */

import { JIRA_REACHABILITY_PROBE_PATHS } from "@crabgic/connectors-jira";

/** Every provider-specific probe path, merged from the connectors that claim one. Grafana claims none: its root neither redirects off-origin nor requires a credential. */
const PROBE_PATHS: Readonly<Record<string, string>> = { ...JIRA_REACHABILITY_PROBE_PATHS };

export function resolveProbePath(provider: string): string | undefined {
  return PROBE_PATHS[provider];
}

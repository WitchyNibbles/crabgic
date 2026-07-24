import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type RemoteResource } from "@eo/contracts";
import type { GrafanaResourceKind } from "../resource-kinds.js";

/**
 * Revision-stamping — additive to phase 20, consumed by roadmap/21-
 * connector-evidence-integration.md's evidence binding (work item 2) and
 * drift-CI replay (work item 5). Mirrors `@eo/connectors-jira`'s own
 * `stampJiraRemoteResource` (18): stamps a tracked Grafana resource's
 * current revision (its `resourceVersion`/ETag/dashboard-version
 * concurrency token — roadmap/21 §Interfaces consumed, "the dashboard-
 * version/resourceVersion/ETag concurrency token used as the 'confirmed
 * remote revision' value for Grafana resources") into a `RemoteResource`
 * (02) instance.
 */
export interface StampGrafanaRemoteResourceInput {
  readonly externalConnectionId: string;
  readonly kind: GrafanaResourceKind;
  readonly externalId: string;
  /** The resourceVersion/ETag/dashboard-version concurrency token, read back after a mutation or a poll. */
  readonly revision: string;
  readonly observedAt: string;
  readonly canonicalUrl?: string;
}

export function stampGrafanaRemoteResource(input: StampGrafanaRemoteResourceInput): RemoteResource {
  const resource: RemoteResource = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    externalConnectionId: input.externalConnectionId,
    resourceKind: input.kind,
    externalId: input.externalId,
    revision: input.revision,
    observedAt: input.observedAt,
    ...(input.canonicalUrl !== undefined ? { canonicalUrl: input.canonicalUrl } : {}),
  };
  return resource;
}

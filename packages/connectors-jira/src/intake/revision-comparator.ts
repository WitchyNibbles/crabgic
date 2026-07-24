import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type RemoteResource } from "@eo/contracts";

/**
 * Revision comparator — roadmap/18 §Interfaces produced: "stamps each
 * intake-tracked issue's `RemoteResource` (P02 schema) instance with its
 * exact remote revision at every milestone poll; diffing two consecutive
 * stamps is the material-change signal." §Exit criteria: "detects a
 * seeded material remote edit between two milestone polls and produces
 * the amendment-review signal."
 */
export interface StampJiraRemoteResourceInput {
  readonly externalConnectionId: string;
  readonly issueKey: string;
  readonly revision: string;
  readonly observedAt: string;
  readonly canonicalUrl?: string;
}

const JIRA_ISSUE_RESOURCE_KIND = "issue";

/** Stamps a tracked Jira issue's current revision into a `RemoteResource` instance. */
export function stampJiraRemoteResource(input: StampJiraRemoteResourceInput): RemoteResource {
  const resource: RemoteResource = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    externalConnectionId: input.externalConnectionId,
    resourceKind: JIRA_ISSUE_RESOURCE_KIND,
    externalId: input.issueKey,
    revision: input.revision,
    observedAt: input.observedAt,
    ...(input.canonicalUrl !== undefined ? { canonicalUrl: input.canonicalUrl } : {}),
  };
  return resource;
}

export type MaterialChangeSignal =
  | { readonly material: true; readonly previousRevision: string; readonly currentRevision: string }
  | { readonly material: false };

/**
 * Diffs two consecutive `RemoteResource` stamps of the SAME tracked
 * resource. Never silently drops a diff — a revision change (any change,
 * by any amount, in either direction) is ALWAYS flagged material; only a
 * byte-identical revision string is non-material. Throws if the two
 * stamps reference different resources (different `externalId` or
 * `resourceKind`) — comparing unrelated resources is a caller bug, never
 * silently tolerated as "no material change."
 */
export function compareRemoteResourceRevisions(
  previous: RemoteResource,
  current: RemoteResource,
): MaterialChangeSignal {
  if (
    previous.externalId !== current.externalId ||
    previous.resourceKind !== current.resourceKind
  ) {
    throw new Error(
      `compareRemoteResourceRevisions: stamps reference different resources (${previous.resourceKind}:${previous.externalId} vs ${current.resourceKind}:${current.externalId})`,
    );
  }
  if (previous.revision === current.revision) {
    return { material: false };
  }
  return { material: true, previousRevision: previous.revision, currentRevision: current.revision };
}

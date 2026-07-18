/**
 * Artifact index registry — roadmap/05-supervisor-daemon.md §Registries:
 * "artifact index." Keyed by `ArtifactIndexEntry.id`
 * (`../router/operations.ts`); `changeSetId`/`evidenceRecordId` are carried
 * on each value, so change-set-scoped listing is a `query()` filter.
 */
import { createInMemoryRegistry, type Registry } from "./registry.js";
import type { ArtifactIndexEntry } from "../router/operations.js";

export function createArtifactIndexRegistry(): Registry<ArtifactIndexEntry> {
  return createInMemoryRegistry<ArtifactIndexEntry>();
}

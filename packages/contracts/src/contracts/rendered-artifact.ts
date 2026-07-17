import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `RenderedArtifact` — roadmap/02-contracts-and-schemas.md §Interfaces
 * produced table: "consumed by 08, 18, 19, 20" (17 produces instances).
 * roadmap/17-renderer-communication-lint.md §Interfaces produced: "every
 * successful `renderWithRegeneration` call returns one" of these.
 *
 * `kind` is deliberately a minimally-constrained non-empty string, NOT the
 * `ArtifactKind` closed union (`branch_name | commit_subject | commit_body |
 * pr_title | pr_body | review_comment | jira_milestone_comment |
 * grafana_annotation`) — per this worker's explicit brief and
 * roadmap/02-contracts-and-schemas.md §Out of scope: "`ArtifactKind` closed
 * union and the `lint()`/`renderWithRegeneration()` pipeline — owned by 17,
 * which consumes `CommunicationPolicy`, `RenderedArtifact`, and the
 * `renderer-core` module produced here." 17 owns defining and closing that
 * union; this schema only carries whatever token 17 stamps onto an
 * instance.
 */
export const RenderedArtifactSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,

    /** See file-level doc comment: minimally-constrained; `ArtifactKind`'s closed union is owned by phase 17, out of scope here. */
    kind: NonEmptyStringSchema,

    /** roadmap/17: the rendered candidate text `lint()`/`renderWithRegeneration()` validated — the bytes every consumer (08/18/19/20) attaches or transports. */
    content: NonEmptyStringSchema,

    /** When 17's pipeline produced this artifact. Chosen by this phase as standard evidence metadata; not itself a separately-named field in 17's prose. */
    renderedAt: TimestampSchema,
  })
  .strict();

export type RenderedArtifact = z.infer<typeof RenderedArtifactSchema>;

import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `RemoteResource` — roadmap/02-contracts-and-schemas.md §Interfaces
 * produced table: "consumed by 18, 20 (tracked), 21 (Requirement↔RemoteResource)."
 * Field list derived from roadmap/18-jira-cloud-adapter.md's revision
 * comparator ("stamps each intake-tracked issue's `RemoteResource` (P02
 * schema) instance with its exact remote revision at every milestone poll;
 * diffing two consecutive stamps is the material-change signal") and
 * roadmap/20-grafana-adapters.md's `RemoteResource` records bullet ("for the
 * 7 Grafana resource kinds ... consumed by 21 work item 1 (Requirement↔
 * RemoteResource mapping)").
 *
 * Deliberately has NO `requirementId` field: roadmap/21-connector-evidence-
 * integration.md §In scope states the Requirement↔RemoteResource linkage is
 * carried by an `evidence_pointer`-typed `JournalEntryType` entry "keyed by
 * `Requirement.id`, tagged `tracking-issue | dashboard | alert`" — the
 * design explicitly puts that linkage in the journal, not embedded on this
 * record, so it isn't duplicated here.
 */
export const RemoteResourceSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,

    /** The `ExternalConnection` this resource was resolved through. */
    externalConnectionId: IdSchema,

    /**
     * The provider-defined resource kind (e.g. Jira issue/epic/board/sprint,
     * roadmap/18; Grafana folder/dashboard/annotation/alert-rule/contact-
     * point/mute-timing/notification-template, roadmap/20's "7 Grafana
     * resource kinds"). Extensible provider-defined vocabulary, not a
     * closed union at this phase — each connector phase owns its own kind
     * list.
     */
    resourceKind: NonEmptyStringSchema,

    /** The resource's own identifier/key in its provider (e.g. a Jira issue key, a Grafana dashboard UID). */
    externalId: NonEmptyStringSchema,

    /**
     * A human-followable link to the resource, for evidence display and
     * roadmap/21's traceability chain ("requirement → work unit → exact
     * object ID → `RemoteResource` → confirmed revision"). Chosen by this
     * phase, not textually named by 16/18/20 — a traceability chain a human
     * reviews needs somewhere to click through to.
     */
    canonicalUrl: z.string().url().optional(),

    /** roadmap/18: "stamps ... with its exact remote revision"; roadmap/20: the read-back-verified revision / resourceVersion-ETag-dashboard-version concurrency token. */
    revision: NonEmptyStringSchema,

    /** roadmap/18: "...at every milestone poll" — when this revision stamp was captured; diffing consecutive stamps' `revision` in `observedAt` order is the material-change signal. */
    observedAt: TimestampSchema,
  })
  .strict();

export type RemoteResource = z.infer<typeof RemoteResourceSchema>;

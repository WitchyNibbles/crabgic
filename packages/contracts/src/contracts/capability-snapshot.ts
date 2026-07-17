import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `CapabilitySnapshot` — roadmap/02-contracts-and-schemas.md §Interfaces
 * produced table: "consumed by 16 (cache), 18, 20." Field list derived
 * verbatim from roadmap/16-gateway-core.md §In scope's `CapabilitySnapshot`
 * bullet: "product/edition/version/API families/resources/actions/
 * permissions/expiry; 15-min cache; invalidation on auth/permission/
 * unsupported errors; unknown versions read-only."
 *
 * `isReadOnly` encodes the "unknown versions read-only" invariant roadmap/18
 * ("unknown editions/versions default read-only") and roadmap/20
 * ("unknown-build → read-only flag") both restate independently for their
 * own providers — one shared field rather than each connector inventing its
 * own.
 */
export const CapabilitySnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,

    /** The `ExternalConnection` this snapshot was discovered from. */
    externalConnectionId: IdSchema,

    /** roadmap/16 §In scope: "...product/edition/version/API families/resources/actions/permissions/expiry" (product). */
    product: NonEmptyStringSchema,
    /** ...(edition) — e.g. Jira's Cloud vs. Data Center 10.3/11.3 (roadmap/19's `DcEditionFeatureMatrix` keys off this). */
    edition: NonEmptyStringSchema,
    /** ...(version). */
    version: NonEmptyStringSchema,
    /** ...(API families) — e.g. Jira's REST v3 vs. Agile, or Grafana's legacy `/api` vs. newer `/apis` route families (roadmap/20: "route table (`/api` vs `/apis` per capability)"). */
    apiFamilies: z.array(NonEmptyStringSchema).readonly(),
    /** ...(resources) — the discovered resource kinds this snapshot grants visibility into. */
    resources: z.array(NonEmptyStringSchema).readonly(),
    /** ...(actions) — the discovered actions available across those resources. */
    actions: z.array(NonEmptyStringSchema).readonly(),
    /** ...(permissions) — the discovered permission/scope grants backing the above. */
    permissions: z.array(NonEmptyStringSchema).readonly(),

    /**
     * roadmap/18 §In scope: "unknown editions/versions default read-only";
     * roadmap/20 §Interfaces produced: "unknown-build → read-only flag."
     * True whenever discovery could not positively confirm write
     * eligibility for this product/edition/version.
     */
    isReadOnly: z.boolean(),

    /**
     * When this snapshot's discovery call was made — the cache-bookkeeping
     * timestamp paired with `expiresAt` below (roadmap/16: "15-min cache").
     * Chosen by this phase to make the TTL window computable; not itself a
     * separately-named field in 16's prose, which names only "expiry."
     */
    discoveredAt: TimestampSchema,

    /** roadmap/16 §In scope: "...permissions/expiry" — the cache-invalidation deadline; 16 owns the 15-min-default policy that computes this value, this schema only carries the resulting instant. */
    expiresAt: TimestampSchema,
  })
  .strict();

export type CapabilitySnapshot = z.infer<typeof CapabilitySnapshotSchema>;

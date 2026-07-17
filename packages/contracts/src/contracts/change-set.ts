import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { RunLifecycleStateSchema } from "../state-machines/run-lifecycle.js";

/**
 * `ChangeSet` (roadmap/02-contracts-and-schemas.md §In scope contract list;
 * "Interfaces produced" table row `ChangeSet | 05, 09, 11 (creates), 15,
 * 21`). Phase 11 instantiates exactly one `ChangeSet` per intake request
 * (roadmap/11-intake-contract-approval.md:27-28, "exactly one `ChangeSet`
 * created per intake request; `draft → awaiting_approval` on completion; §
 * Interfaces produced item 2, "11 is the phase that instantiates
 * ChangeSets, one per intake"). It is the durable unit 05's registries
 * persist (05-supervisor-daemon.md:19,45,71), 09's `evidence`/`cancel
 * <change-set-id>` commands target (09-cli-and-doctor.md:132,164,212), 15
 * attaches an enforced `PerformanceContract` to
 * (15-performance-contracts.md:57), and 21 resolves traceability against
 * (21-connector-evidence-integration.md:88).
 */
export const ChangeSetSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This `ChangeSet`'s own identity (11-intake-contract-approval.md:69). */
    id: IdSchema,

    /**
     * The `ChangeSet`'s own lifecycle stage. roadmap/11:27-28 states the
     * `ChangeSet`'s lifecycle in the exact vocabulary of the run-lifecycle
     * enum ("`draft → awaiting_approval` on completion"), and 11:124-125
     * lists "Run-lifecycle states transitioned into/out of: `draft`,
     * `awaiting_approval`, `ready`, `blocked`, `cancelled`" as transitions
     * of the `ChangeSet` itself — this is the identical closed union
     * `../state-machines/run-lifecycle.js` exports, reused verbatim per
     * this phase's hard convention (never a re-typed string list), matching
     * the same reuse required of `RunSnapshot.runState` below.
     */
    state: RunLifecycleStateSchema,

    /**
     * Cross-reference to this `ChangeSet`'s `IntentContract` instance
     * (11:72-73, "`IntentContract` (02) instance … consumed by 18 …
     * 21"). `IntentContract` is owned by a different phase-02 worker;
     * referenced by id only, never embedded (hard convention).
     */
    intentContractId: IdSchema,

    /**
     * Cross-reference to the canonical hash-stable `AuthorizationEnvelope`
     * this `ChangeSet`'s dispatch compiles from (11:78-80,
     * "`AuthorizationEnvelope` (02) instance, canonical hash-stable").
     */
    authorizationEnvelopeId: IdSchema,

    /**
     * Cross-reference to the digest-pinned `CapabilityManifest` instance
     * (11:81-82, "`CapabilityManifest` (02) instance, digest-pinned").
     */
    capabilityManifestId: IdSchema,

    /**
     * Cross-reference to the *provisional* `PerformanceContract` 11
     * populates at approval-preview time (11:122, "`PerformanceContract`
     * (provisional budgets)"; 15-performance-contracts.md:57, "the
     * provisional figure 11 already populated at approval time").
     */
    provisionalPerformanceContractId: IdSchema,

    /**
     * Cross-reference to the measurement-backed, hash-linked
     * `PerformanceContract` phase 15 attaches at gate time
     * (15-performance-contracts.md:57, "this phase builds the
     * measurement-backed, hash-linked instance at gate time and attaches
     * it to the ChangeSet … alongside the provisional figure"). Absent
     * until 15's gate fires — optional.
     */
    enforcedPerformanceContractId: IdSchema.optional(),

    /**
     * Ordered `WorkUnit` id list describing the DAG's integration order
     * (11:29-30, "Planning outputs: decision-complete DAG, roster …,
     * write ownership, integration order, rollback strategy" — a
     * `ChangeSet`-wide planning output, distinct from any single
     * `WorkUnit`'s own fields).
     */
    integrationOrder: z.array(IdSchema),

    /**
     * Free-text rollback strategy for the whole `ChangeSet` (11:29-30,
     * same "Planning outputs" bullet). No structured shape is pinned
     * anywhere in the source material, so a non-empty description string
     * is this phase's own minimal-sufficient choice, not a further
     * structured sub-schema.
     */
    rollbackStrategy: NonEmptyStringSchema,

    /** Instance creation time. */
    createdAt: TimestampSchema,
  })
  .strict();

export type ChangeSet = z.infer<typeof ChangeSetSchema>;

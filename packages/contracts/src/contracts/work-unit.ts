import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";
import { WorkUnitAttemptStatusSchema } from "../state-machines/work-unit-attempt-status.js";

/**
 * `WorkUnit` (roadmap/02-contracts-and-schemas.md §In scope contract list;
 * "Interfaces produced" table row `WorkUnit (carries session_id, §4.5) | 04,
 * 05, 06, 11 (DAG), 13`). One node in the decision-complete DAG phase 11
 * assembles per `ChangeSet` (roadmap/11-intake-contract-approval.md:75-77,
 * "Decision-complete DAG: `WorkUnit` (02) graph + roster (role → model) +
 * write ownership + integration order + rollback strategy. Consumed by 04
 * (journal typing), 05 (registries), 06 (`session_id` assignment), 13
 * (executor readiness + router)").
 *
 * Carries the engine `session_id` field literally named `session_id`
 * (snake_case — the engine-derived name adaptation §4.5 uses verbatim:
 * "Persist `session_id` (supervisor-chosen via `--session-id <uuid>` …) in
 * the WorkUnit record"). It is OPTIONAL: a freshly-planned `WorkUnit` has
 * no session until 06 assigns one immediately before spawn
 * (roadmap/06-claude-engine-adapter.md:44, "a supervisor-chosen UUID
 * journaled (`session_assignment`) before spawn").
 */
export const WorkUnitSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This `WorkUnit`'s own identity. */
    id: IdSchema,

    /** Cross-reference to the owning `ChangeSet` (11:75-77, the DAG this unit belongs to). */
    changeSetId: IdSchema,

    /**
     * Human-legible short label for this DAG node. Not itself cited by any
     * roadmap file's field list; this phase's own minimal-sufficient
     * addition so 11's approval-preview render ("renders contract + plan
     * … to the human," 11:38) has something legible to show per unit,
     * distinct from `TaskPacket.objective`'s fuller dispatch-time text.
     */
    title: NonEmptyStringSchema,

    /**
     * Stable `Requirement` ids this unit fulfills — half of 11's
     * bidirectional requirement ↔ work-unit mapping (11:26, "bidirectional
     * requirement ↔ work-unit/artifact/test/evidence mapping").
     */
    requirementIds: z.array(IdSchema),

    /**
     * Other `WorkUnit` ids this unit depends on — the DAG edges themselves
     * (11:75, "`WorkUnit` (02) graph"; 13-scheduler-packets-context.md:72,
     * "readiness computation against hand-built dependency … fixtures").
     */
    dependsOn: z.array(IdSchema),

    /**
     * Roster role this unit is dispatched under (11:29, "roster (role →
     * model, balanced routing)"; 13:22, "Model routing: role → alias map …
     * resolved at dispatch time"). No closed role vocabulary is pinned
     * anywhere this phase owns — 13 owns the role→model alias map this
     * resolves against — so this is a free-text, non-empty string, this
     * phase's own minimal-sufficient choice, not a closed union.
     */
    role: NonEmptyStringSchema,

    /**
     * Paths this unit owns exclusive write access to (11:29-30, "write
     * ownership"; 13:19,44, TaskPacket's own "owned paths (11's write
     * ownership)" is derived from this per-unit set at dispatch time).
     */
    ownedPaths: z.array(NonEmptyStringSchema),

    /**
     * This unit's current/latest attempt status, reusing the closed
     * `WorkUnitAttemptStatus` union exported by
     * `../state-machines/work-unit-attempt-status.js` — never re-typed
     * (roadmap/04-journal-idempotency-leases.md:19, "every `WorkUnit` (02)
     * attempt persisted with its engine `session_id` and a status typed
     * against `WorkUnitAttemptStatus`" — the same sentence that pairs
     * `session_id` with attempt status is why both fields live together
     * here). Required: a newly-planned unit starts `pending`, the union's
     * own initial state.
     */
    attemptStatus: WorkUnitAttemptStatusSchema,

    /**
     * Engine session id (adaptation §4.5; roadmap/02 §In scope, "`WorkUnit`
     * (carries the engine `session_id` field, adaptation §4.5)"; test plan:
     * "`WorkUnit.session_id` optionality"). A supervisor-minted UUID,
     * journaled as `session_assignment` before spawn (06:44); retained
     * across `parked:rate_limit` so `resume` can continue the same engine
     * conversation (04:19). Optional — absent before first dispatch.
     */
    session_id: IdSchema.optional(),
  })
  .strict();

export type WorkUnit = z.infer<typeof WorkUnitSchema>;

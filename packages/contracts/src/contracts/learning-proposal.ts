import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { LearningProposalStateSchema } from "../learning/learning-proposal-state.js";

/**
 * `LearningProposal` (roadmap/02-contracts-and-schemas.md §In scope
 * contract list; "Interfaces produced" table row `LearningProposal | 22
 * (state machine), 09, 23`). Its `state` field type IS
 * `LearningProposalStateSchema`, imported from
 * `../learning/learning-proposal-state.js` (roadmap/22-learning-system.md:
 * 37, "the union itself belongs in P02 (`packages/contracts`) as the type
 * of `LearningProposal.state`"). Phase 22 owns the transition-table tests,
 * guards, and promotion enforcement over this state field; this phase
 * (02) owns only the union and this schema's shape.
 */
export const LearningProposalSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This `LearningProposal`'s own identity. */
    id: IdSchema,

    /**
     * The proposal's pipeline stage — reuses `LearningProposalStateSchema`
     * (11 members: `observation | reproducer | candidate | dev_eval |
     * held_out_eval | shadow_run | independent_review | promoted |
     * rejected | rolled_back | expired`), never re-typed.
     */
    state: LearningProposalStateSchema,

    /**
     * The lesson's own text/preamble content. This is what 13's ephemeral
     * lesson-preamble injection point copies as its caller-supplied
     * preamble string for an in-run repair or shadow-run
     * (roadmap/13-scheduler-packets-context.md:19,47, "accepts a
     * caller-supplied preamble string for exactly two callers"). No exact
     * field name/shape is pinned by any cited source; a single non-empty
     * content string is this phase's own minimal-sufficient choice over
     * splitting title/body, since 13 only ever needs one preamble string.
     */
    content: NonEmptyStringSchema,

    /**
     * `EvidenceRecord` ids this lesson cites (roadmap/22-learning-system.md:
     * 23, "lessons carry `EvidenceRecord` references; a referenced record
     * going stale … raises an expiry proposal").
     */
    evidenceRecordIds: z.array(IdSchema),

    /**
     * The `WorkUnit` whose attempt history/fan-out pattern this proposal
     * observes (22:47, "`WorkUnitAttemptStatus` attempt history as
     * observation-stage input signal"; "fan-out rationale records as
     * scheduling-lesson candidates"). Optional and deliberately singular:
     * no cited source pins an exact traceability field shape for
     * observation provenance — this is this phase's own minimal-sufficient
     * choice for a single originating unit, not a richer provenance
     * structure.
     */
    sourceWorkUnitId: IdSchema.optional(),

    /**
     * Cross-reference to the inverse `ChangeSet` a `rolled_back` proposal
     * dispatches (22:23, "promoted-lesson rollback dispatches an inverse
     * `ChangeSet` through the same pipeline and restores prior behavior").
     * Absent until a rollback is actually triggered — optional.
     */
    rollbackChangeSetId: IdSchema.optional(),

    /** Instance creation time. */
    createdAt: TimestampSchema,
  })
  .strict();

export type LearningProposal = z.infer<typeof LearningProposalSchema>;

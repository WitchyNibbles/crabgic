import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";

/**
 * `TaskPacket` (roadmap/02-contracts-and-schemas.md §In scope contract
 * list; "Interfaces produced" table row `TaskPacket | 03 (spawn input), 06,
 * 13 (builds)`). Built per dispatch attempt by phase 13's scheduler
 * (roadmap/13-scheduler-packets-context.md:19, "TaskPacket builder:
 * requirement IDs, objective, non-goals, exact base object ID (07's
 * freeze), relevant interfaces, owned paths (11's write ownership),
 * constraints, resource limits, gates, result schema — nothing else; size
 * budgets enforced"), and consumed as `EngineAdapter.spawn()`'s first
 * parameter (roadmap/06-claude-engine-adapter.md:65).
 *
 * Size-budget enforcement itself is 13's own runtime concern ("a field
 * exceeding budget blocks dispatch with a diff, never silent truncation,"
 * 13:72) — this schema defines the shape, not the byte-budget thresholds,
 * which are not pinned by any source material this phase cites.
 *
 * 13:19/47 also names an "ephemeral lesson-preamble slot" on the TaskPacket
 * *builder*, populated only for an in-run repair or a shadow-run attempt —
 * but the same sentence states it is "never a persistent packet field,
 * never read anywhere else." That slot is therefore deliberately NOT a
 * field on this persisted contract schema (see final report's deviations
 * note).
 */
export const TaskPacketSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This `TaskPacket`'s own identity — one instance per dispatch attempt. */
    id: IdSchema,

    /** Cross-reference to the `WorkUnit` this packet dispatches (13:44). */
    workUnitId: IdSchema,

    /** Requirement ids this attempt is scoped to (13:19, "requirement IDs"). */
    requirementIds: z.array(IdSchema),

    /** What the worker must accomplish (13:19, "objective"). */
    objective: NonEmptyStringSchema,

    /** Explicit exclusions for this attempt (13:19, "non-goals"). */
    nonGoals: z.array(NonEmptyStringSchema),

    /**
     * The exact frozen base Git object id this attempt is dispatched
     * against (13:19, "exact base object ID (07's freeze)"; 13:54, "the
     * frozen base object ID (Intake freeze) populating each TaskPacket's
     * base-object-id field"). A Git object id, not a UUID — `NonEmptyString`,
     * not `IdSchema`.
     */
    baseObjectId: NonEmptyStringSchema,

    /** Interface descriptions/paths relevant to this attempt (13:19, "relevant interfaces"). */
    relevantInterfaces: z.array(NonEmptyStringSchema),

    /** Paths this attempt may write to, copied from the owning `WorkUnit`'s write ownership (13:19,44). */
    ownedPaths: z.array(NonEmptyStringSchema),

    /** Free-text constraints on this attempt, narrower than the envelope itself (13:19, "constraints"). */
    constraints: z.array(NonEmptyStringSchema),

    /**
     * Resource limits for this attempt. `maxTurns` maps to the SDK/CLI
     * `--max-turns` cap (adaptation §5.2/§5.3); `maxBudgetUsd` maps to
     * `--max-budget-usd`, informational-only under subscription auth
     * (adaptation §5.7, "dollar figures stay informational"; 06:19, "dollar
     * budgets stay informational under subscription auth, §5.7") — hence
     * optional while `maxTurns` (the primary cap under subscription auth)
     * is required.
     */
    resourceLimits: z
      .object({
        maxTurns: z.number().int().positive(),
        maxBudgetUsd: z.number().nonnegative().optional(),
      })
      .strict(),

    /**
     * Risk-tag identifiers this attempt's gate registry should fire
     * (13:19, "gates"; 14-quality-security-gates.md:49, "this phase
     * supplies gate definitions/thresholds that ride inside 13's
     * `TaskPacket.gates` field"). Modeled as a list of gate/risk-tag
     * identifiers — 14's own registry resolves the richer
     * definition/threshold shape server-side from the tag; that
     * per-gate-threshold shape is 14's internal registry data, not carried
     * on this packet. This phase's own minimal-sufficient choice: no field
     * shape for it is pinned anywhere in the cited source material.
     */
    gates: z.array(NonEmptyStringSchema),

    /**
     * The JSON Schema document handed to the engine's `--json-schema`/
     * `structured_output` validation (adaptation §4.4, "`claude -p
     * --output-format json --json-schema '<schema>'`"; 13:19, "result
     * schema"). Always ultimately `WorkerResultSchema`'s own JSON Schema
     * export in practice, but modeled here as an opaque JSON object bag
     * (`Record<string, unknown>`) rather than re-deriving a
     * schema-of-a-schema type — this phase's own minimal-sufficient
     * choice for an inherently recursive JSON Schema value.
     */
    resultSchema: z.record(z.string(), z.unknown()),
  })
  .strict();

export type TaskPacket = z.infer<typeof TaskPacketSchema>;

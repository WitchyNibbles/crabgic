import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema } from "../shared/ids.js";
import { WORK_UNIT_ATTEMPT_STATUS_TERMINALS } from "../state-machines/work-unit-attempt-status.js";

/**
 * `WorkerResult` (roadmap/02-contracts-and-schemas.md §In scope contract
 * list; "Interfaces produced" table row `WorkerResult | 06 (schema-enforced
 * via --json-schema), 14`). The shape phase 06 validates a worker's
 * `structured_output` against (roadmap/06-claude-engine-adapter.md:19,
 * "`WorkerResult` schema enforced via `--json-schema`/`structured_output`;
 * … schema violation → typed failure entering the repair-attempt path";
 * 06:66, "`WorkerResult` schema — the shape `structured_output` is
 * validated against"). Its pass/fail outcome feeds 13's attempt policy
 * (06:45, "`WorkerResult` validation outcome … feeds 13's 'one initial +
 * two evidence-driven repairs' attempt policy"; 13:17, "either the
 * worker's own reported failure (WorkerResult) or a gate verdict … is 'new
 * diagnostic evidence'").
 */
export const WorkerResultSchema = z
  .object({
    schemaVersion: SchemaVersionField,

    /** This `WorkerResult`'s own identity — one instance per completed attempt. */
    id: IdSchema,

    /** Cross-reference to the `WorkUnit` this result was produced for. */
    workUnitId: IdSchema,

    /**
     * The attempt's terminal outcome as self-reported by the worker.
     * Reuses `WORK_UNIT_ATTEMPT_STATUS_TERMINALS` (`succeeded | failed |
     * cancelled`) exported by
     * `../state-machines/work-unit-attempt-status.js` rather than
     * hand-typing a second, overlapping tri-state union — satisfying this
     * phase's "reuse, never redefine" hard convention for attempt-status
     * fields while staying semantically correct: a worker only ever
     * self-reports a completed attempt's terminal state, never
     * `pending`/`dispatched`/`parked:rate_limit`, which are scheduler-only
     * states this schema deliberately excludes.
     */
    outcome: z.enum(WORK_UNIT_ATTEMPT_STATUS_TERMINALS),

    /**
     * Short human/model-authored summary of what the attempt did. No exact
     * field shape is pinned by any cited source; a non-empty summary
     * string is this phase's own minimal-sufficient choice for a legible
     * result payload.
     */
    summary: NonEmptyStringSchema,

    /**
     * Failure/repair-relevant diagnostic notes — the worker's own half of
     * the "new diagnostic evidence" a repair attempt requires (13:17, "the
     * worker's own reported failure (WorkerResult) … as one of two sources
     * of 'new diagnostic evidence' for a repair attempt"). May be empty on
     * a clean `succeeded` outcome.
     */
    diagnostics: z.array(NonEmptyStringSchema),

    /**
     * Usage/turn accounting (adaptation §4.4, "result JSON carries …
     * `total_cost_usd`, `usage`"; 06:19, "usage/turn accounting captured
     * (dollar budgets stay informational under subscription auth,
     * §5.7)"). `totalCostUsd` is optional/informational-only —
     * `turnsUsed` is the load-bearing cap under subscription auth (§5.7).
     */
    usage: z
      .object({
        turnsUsed: z.number().int().nonnegative(),
        totalCostUsd: z.number().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export type WorkerResult = z.infer<typeof WorkerResultSchema>;

/**
 * The half of a `WorkerResult` a WORKER may author — and the schema actually
 * published to the engine as `outputFormat`.
 *
 * WHY THIS EXISTS. Until 2026-08-16 the daemon published a hand-written
 * two-property JSON Schema (`{outcome, summary}`, `required: ["outcome"]`)
 * while `validateWorkerResult` enforced the full seven-field
 * `WorkerResultSchema` against the raw structured output. Two schemas that had
 * to agree, and did not: every worker obeyed the published contract exactly and
 * every result was then rejected as malformed. Measured on run 97fb3b10, where
 * a worker wrote correct code and the attempt failed anyway.
 *
 * The split is not merely a fix for that mismatch — it is the right boundary.
 * `id` and `workUnitId` are the HARNESS's facts, and a worker asserting its own
 * `workUnitId` would be claiming an identity nothing checks; `usage` is the
 * ENGINE's fact, already carried on the result event; `schemaVersion` is a
 * constant. Asking a model for any of them invites fabrication, and one of them
 * is an impersonation vector. A worker reports only what it alone knows: what
 * happened, and what it saw.
 */
export const WorkerAuthoredResultSchema = z
  .object({
    outcome: z.enum(WORK_UNIT_ATTEMPT_STATUS_TERMINALS),
    summary: NonEmptyStringSchema,
    diagnostics: z.array(NonEmptyStringSchema),
  })
  .strict();

export type WorkerAuthoredResult = z.infer<typeof WorkerAuthoredResultSchema>;

/**
 * `validateWorkerResult` — this package's OWN copy of the engine-agnostic
 * half of `packages/engine-claude/src/result-validation.ts`'s logic,
 * deliberately NOT imported from `@eo/engine-claude`: this phase's executor
 * must work against ANY `EngineAdapter` (the abstract contract owned by
 * `@eo/engine-core`, roadmap/13's actual "Interfaces consumed" dependency),
 * not specifically the Claude adapter — importing `@eo/engine-claude` here
 * would create an unwanted, undeclared 13→06(concrete) dependency edge on
 * top of the already-declared 13→06(abstract, via engine-core) one, and
 * would make this package untestable against the fake engine alone (the
 * fake engine implements `@eo/engine-core`'s `EngineAdapter`, never
 * `@eo/engine-claude`'s concrete class).
 *
 * Same rules as 06's own validator (docs/engine-baseline.md §5), applied in
 * the same order, over the SAME `EngineResultEvent` shape (`@eo/engine-
 * core`) and the SAME `WorkerResultSchema` (`@eo/contracts`) — this is
 * intentional parallel logic, not a fork of a *different* algorithm; a
 * future reconcile could extract a shared micro-package, but 06 is already
 * built and frozen, so duplicating this ~40-line pure function here is the
 * documented, minimal-risk choice for this phase's own build.
 */
import { WorkerResultSchema, type WorkerResult } from "@eo/contracts";
import type { EngineResultEvent } from "@eo/engine-core";

export type SchedulerSchemaViolationReason = "absent" | "invalid" | "retriesExhausted";

export type SchedulerWorkerResultValidation =
  | {
      readonly kind: "valid";
      readonly result: WorkerResult;
      readonly usage: {
        readonly turnsUsed?: number;
        readonly totalCostUsd?: number;
      };
    }
  | {
      readonly kind: "schemaViolation";
      readonly reason: SchedulerSchemaViolationReason;
      readonly diagnostics: readonly string[];
    };

const STRUCTURED_OUTPUT_RETRIES_EXHAUSTED_SUBTYPE = "error_max_structured_output_retries";

function diagnosticFor(issue: {
  readonly path: readonly (string | number)[];
  readonly code: string;
}): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.code}`;
}

/**
 * Validates an `EngineResultEvent` against `WorkerResultSchema`, in the
 * exact rule order docs/engine-baseline.md §5 specifies — see this
 * module's file-level doc comment for why this is a deliberate parallel of
 * 06's own validator, not an import of it.
 */
export function validateWorkerResult(result: EngineResultEvent): SchedulerWorkerResultValidation {
  if (result.subtype === STRUCTURED_OUTPUT_RETRIES_EXHAUSTED_SUBTYPE) {
    return {
      kind: "schemaViolation",
      reason: "retriesExhausted",
      diagnostics: [
        `engine result subtype "${STRUCTURED_OUTPUT_RETRIES_EXHAUSTED_SUBTYPE}" (docs/engine-baseline.md §5)`,
      ],
    };
  }

  if (result.structuredOutput === undefined) {
    return {
      kind: "schemaViolation",
      reason: "absent",
      diagnostics: [
        `engine result subtype "${result.subtype}" carried no structured_output (docs/engine-baseline.md §5's observed violation shape)`,
      ],
    };
  }

  const parsed = WorkerResultSchema.safeParse(result.structuredOutput);
  if (!parsed.success) {
    return {
      kind: "schemaViolation",
      reason: "invalid",
      diagnostics: parsed.error.issues.map(diagnosticFor),
    };
  }

  return {
    kind: "valid",
    result: parsed.data,
    usage: {
      ...(result.turnsUsed !== undefined ? { turnsUsed: result.turnsUsed } : {}),
      ...(result.totalCostUsd !== undefined ? { totalCostUsd: result.totalCostUsd } : {}),
    },
  };
}

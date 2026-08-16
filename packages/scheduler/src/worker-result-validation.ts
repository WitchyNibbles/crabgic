/**
 * `validateWorkerResult` — this package's OWN copy of the engine-agnostic
 * half of `packages/engine-claude/src/result-validation.ts`'s logic,
 * deliberately NOT imported from `@crabgic/engine-claude`: this phase's executor
 * must work against ANY `EngineAdapter` (the abstract contract owned by
 * `@crabgic/engine-core`, roadmap/13's actual "Interfaces consumed" dependency),
 * not specifically the Claude adapter — importing `@crabgic/engine-claude` here
 * would create an unwanted, undeclared 13→06(concrete) dependency edge on
 * top of the already-declared 13→06(abstract, via engine-core) one, and
 * would make this package untestable against the fake engine alone (the
 * fake engine implements `@crabgic/engine-core`'s `EngineAdapter`, never
 * `@crabgic/engine-claude`'s concrete class).
 *
 * Same rules as 06's own validator (docs/engine-baseline.md §5), applied in
 * the same order, over the SAME `EngineResultEvent` shape (`@crabgic/engine-
 * core`) and the SAME `WorkerResultSchema` (`@crabgic/contracts`) — this is
 * intentional parallel logic, not a fork of a *different* algorithm; a
 * future reconcile could extract a shared micro-package, but 06 is already
 * built and frozen, so duplicating this ~40-line pure function here is the
 * documented, minimal-risk choice for this phase's own build.
 */
import { randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  WorkerAuthoredResultSchema,
  type WorkerResult,
} from "@crabgic/contracts";
import type { EngineResultEvent } from "@crabgic/engine-core";

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
  // zod 4 widened `ZodIssue.path` from `(string | number)[]` to
  // `PropertyKey[]` — it can now contain symbols, because a schema may key
  // on one. `String(segment)` is what keeps this a total function over the
  // real type rather than one that happens to fit the common case.
  readonly path: readonly PropertyKey[];
  readonly code: string;
}): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
  return `${path}: ${issue.code}`;
}

/**
 * Validates an `EngineResultEvent` against `WorkerResultSchema`, in the
 * exact rule order docs/engine-baseline.md §5 specifies — see this
 * module's file-level doc comment for why this is a deliberate parallel of
 * 06's own validator, not an import of it.
 */
export function validateWorkerResult(
  result: EngineResultEvent,
  workUnitId: string,
): SchedulerWorkerResultValidation {
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

  /**
   * Parsed against the WORKER-AUTHORED half, which is exactly the schema
   * published to the engine as `outputFormat` — see
   * `WorkerAuthoredResultSchema`. It used to parse the full `WorkerResult`
   * against raw structured output while the daemon published a two-property
   * document, so a compliant worker was rejected every time (measured, run
   * 97fb3b10, 2026-08-16).
   *
   * The remaining fields are COMPOSED here rather than requested: `id` and
   * `workUnitId` are the harness's facts — a worker asserting its own
   * `workUnitId` would be claiming an identity nothing verifies — `usage` is
   * the engine's, carried on this very event, and `schemaVersion` is a
   * constant. Asking a model for any of them invites fabrication, and one is
   * an impersonation vector.
   */
  const parsed = WorkerAuthoredResultSchema.safeParse(result.structuredOutput);
  if (!parsed.success) {
    return {
      kind: "schemaViolation",
      reason: "invalid",
      diagnostics: parsed.error.issues.map(diagnosticFor),
    };
  }

  return {
    kind: "valid",
    result: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      workUnitId,
      outcome: parsed.data.outcome,
      summary: parsed.data.summary,
      diagnostics: parsed.data.diagnostics,
      usage: {
        turnsUsed: result.turnsUsed ?? 0,
        ...(result.totalCostUsd !== undefined ? { totalCostUsd: result.totalCostUsd } : {}),
      },
    } satisfies WorkerResult,
    usage: {
      ...(result.turnsUsed !== undefined ? { turnsUsed: result.turnsUsed } : {}),
      ...(result.totalCostUsd !== undefined ? { totalCostUsd: result.totalCostUsd } : {}),
    },
  };
}

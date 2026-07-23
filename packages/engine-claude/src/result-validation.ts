/**
 * `validateWorkerResult` — enforces `WorkerResult` (`@eo/contracts`, zod-3)
 * against the normalized `EngineResultEvent` (`@eo/engine-core`)'s
 * `structuredOutput` field (roadmap/06-claude-engine-adapter.md work item
 * 4). Every non-`valid` outcome is a typed `schemaViolation` — this
 * validator never silently passes an absent, malformed, or
 * retry-exhausted result through as if it were a valid `WorkerResult`
 * (exit criterion `structured-output-violation.test`).
 *
 * RULES (docs/engine-baseline.md §5's directive, applied in this exact
 * order):
 *
 *   1. `subtype === "error_max_structured_output_retries"` -> reason
 *      `"retriesExhausted"`. This is the SDK-TYPED variant (`sdk.d.ts`
 *      0.3.210's `SDKResultError.subtype` union) baseline §5 explicitly
 *      records as UNOBSERVED live — cited as a typed possibility, never a
 *      confirmed live sample (Hard Rule 1). Checked first and
 *      unconditionally: this subtype is definitionally a violation
 *      regardless of whether `structuredOutput` happens to be present.
 *   2. `structuredOutput === undefined` -> reason `"absent"`. This is
 *      baseline §5's OWN OBSERVED violation shape, verbatim: "the model
 *      declined to call the internal `StructuredOutput` tool at all... The
 *      result still came back `subtype: 'success'`... with
 *      `structured_output: undefined`". Checked for any subtype other than
 *      the retry-exhausted one above (baseline only ever observed this
 *      with `subtype: 'success'`, but structurally there is equally no
 *      output to validate under any other non-retry-exhausted subtype
 *      either — never a silent pass in that case, matching this file's own
 *      overriding "never a silent pass" ground rule).
 *   3. `structuredOutput` present but failing `WorkerResultSchema` -> reason
 *      `"invalid"`, `diagnostics` built from zod's issues.
 *   4. Otherwise (present and schema-valid) -> `"valid"`, the parsed
 *      `WorkerResult` plus usage passthrough.
 *
 * DIAGNOSTICS REDACTION (roadmap/06 §Security; this worker's brief:
 * "redact values, keep paths"): each `"invalid"` diagnostic string is built
 * from ONLY the zod issue's `path` and `code` — never `issue.message` or
 * any received value. Some zod v3 message strings interpolate the actual
 * offending value for certain issue codes (e.g. `invalid_literal`); using
 * only `path`+`code` guarantees no worker-authored (or attacker-influenced)
 * `structuredOutput` content ever leaks into a diagnostic string.
 */
import { WorkerResultSchema, type WorkerResult } from "@eo/contracts";
import type { EngineResultEvent } from "@eo/engine-core";

export type SchemaViolationReason = "absent" | "invalid" | "retriesExhausted";

export type WorkerResultValidation =
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
      readonly reason: SchemaViolationReason;
      readonly diagnostics: readonly string[];
    };

/**
 * SDK-typed (`sdk.d.ts` 0.3.210 `SDKResultError.subtype`), unobserved live
 * per docs/engine-baseline.md §5 — cited as a possibility, never a
 * confirmed sample.
 */
const STRUCTURED_OUTPUT_RETRIES_EXHAUSTED_SUBTYPE = "error_max_structured_output_retries";

function diagnosticFor(issue: {
  readonly path: readonly (string | number)[];
  readonly code: string;
}): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.code}`;
}

export function validateWorkerResult(result: EngineResultEvent): WorkerResultValidation {
  if (result.subtype === STRUCTURED_OUTPUT_RETRIES_EXHAUSTED_SUBTYPE) {
    return {
      kind: "schemaViolation",
      reason: "retriesExhausted",
      diagnostics: [
        `engine result subtype "${STRUCTURED_OUTPUT_RETRIES_EXHAUSTED_SUBTYPE}" (docs/engine-baseline.md §5: SDK-typed, unobserved-live variant)`,
      ],
    };
  }

  if (result.structuredOutput === undefined) {
    return {
      kind: "schemaViolation",
      reason: "absent",
      diagnostics: [
        `engine result subtype "${result.subtype}" carried no structured_output (docs/engine-baseline.md §5's observed violation shape: subtype "success" with structured_output absent)`,
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

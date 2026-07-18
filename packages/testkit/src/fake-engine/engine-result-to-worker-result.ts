import {
  CURRENT_SCHEMA_VERSION,
  WorkerResultSchema,
  type Id,
  type WorkerResult,
} from "@eo/contracts";
import type { EngineResultEvent } from "@eo/engine-core";

/**
 * Maps a terminal `EngineResultEvent` onto a `WorkerResult` (@eo/contracts)
 * — used by the exit-criterion-5 demo (`demo.test.ts`) to show a denied
 * smuggled command surfacing as a structured `WorkerResult`-shaped
 * failure. This mapping is this worker's own minimal-sufficient decision
 * (not pinned by any cited source material; 13/06 own the real
 * EngineResultEvent-to-scheduler mapping downstream of this phase).
 */
export function toWorkerResult(event: EngineResultEvent, id: Id, workUnitId: Id): WorkerResult {
  const hasDenials = event.permissionDenials.length > 0;
  const outcome: "failed" | "succeeded" = event.isError || hasDenials ? "failed" : "succeeded";
  const diagnostics = event.permissionDenials.map(
    (denial) => `Denied tool call: ${denial.toolName} ${JSON.stringify(denial.toolInput)}`,
  );
  const summary = hasDenials
    ? `Attempt blocked: ${event.permissionDenials.length} tool call(s) denied by policy.`
    : "Attempt completed.";

  return WorkerResultSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    workUnitId,
    outcome,
    summary,
    diagnostics,
    usage: {
      turnsUsed: event.turnsUsed ?? 0,
      totalCostUsd: event.totalCostUsd,
    },
  });
}

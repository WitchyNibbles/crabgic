import { CURRENT_SCHEMA_VERSION, WorkerResultSchema, type WorkerResult } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `WorkerResult` fixture builder — roadmap/02 work item 10. */
export function buildWorkerResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  const ctx = createFixtureContext();
  const defaults: WorkerResult = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    workUnitId: ctx.ids.next(),
    outcome: "succeeded",
    summary: "Deterministic fixture attempt completed successfully.",
    diagnostics: [],
    usage: { turnsUsed: 3 },
  };
  return WorkerResultSchema.parse({ ...defaults, ...overrides });
}

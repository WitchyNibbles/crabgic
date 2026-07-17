import { CURRENT_SCHEMA_VERSION, RunSnapshotSchema, type RunSnapshot } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `RunSnapshot` fixture builder — roadmap/02 work item 10. */
export function buildRunSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  const ctx = createFixtureContext();
  const defaults: RunSnapshot = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    runId: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    runState: "draft",
    journalSequenceNumber: 0,
    capturedAt: ctx.clock.next(),
  };
  return RunSnapshotSchema.parse({ ...defaults, ...overrides });
}

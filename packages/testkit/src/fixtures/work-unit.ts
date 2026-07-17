import { CURRENT_SCHEMA_VERSION, WorkUnitSchema, type WorkUnit } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `WorkUnit` fixture builder — roadmap/02 work item 10. */
export function buildWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  const ctx = createFixtureContext();
  const defaults: WorkUnit = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    title: "Deterministic fixture work unit",
    requirementIds: [],
    dependsOn: [],
    role: "implementation",
    ownedPaths: ["packages/example/src/"],
    attemptStatus: "pending",
  };
  return WorkUnitSchema.parse({ ...defaults, ...overrides });
}

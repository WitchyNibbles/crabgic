import { CURRENT_SCHEMA_VERSION, TaskPacketSchema, type TaskPacket } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `TaskPacket` fixture builder — roadmap/02 work item 10. */
export function buildTaskPacket(overrides: Partial<TaskPacket> = {}): TaskPacket {
  const ctx = createFixtureContext();
  const defaults: TaskPacket = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    workUnitId: ctx.ids.next(),
    requirementIds: [],
    objective: "Implement the deterministic fixture's stated objective.",
    nonGoals: [],
    baseObjectId: "0000000000000000000000000000000000000a",
    relevantInterfaces: [],
    ownedPaths: ["packages/example/src/"],
    constraints: [],
    resourceLimits: { maxTurns: 40 },
    gates: [],
    resultSchema: {},
  };
  return TaskPacketSchema.parse({ ...defaults, ...overrides });
}

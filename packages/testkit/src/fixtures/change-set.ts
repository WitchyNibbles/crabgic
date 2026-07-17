import { CURRENT_SCHEMA_VERSION, ChangeSetSchema, type ChangeSet } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `ChangeSet` fixture builder — roadmap/02 work item 10. */
export function buildChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  const ctx = createFixtureContext();
  const defaults: ChangeSet = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    state: "draft",
    intentContractId: ctx.ids.next(),
    authorizationEnvelopeId: ctx.ids.next(),
    capabilityManifestId: ctx.ids.next(),
    provisionalPerformanceContractId: ctx.ids.next(),
    integrationOrder: [],
    rollbackStrategy: "Revert the integration commit and restore prior behavior.",
    createdAt: ctx.clock.next(),
  };
  return ChangeSetSchema.parse({ ...defaults, ...overrides });
}

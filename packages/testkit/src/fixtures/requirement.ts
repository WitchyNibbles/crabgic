import { CURRENT_SCHEMA_VERSION, RequirementSchema, type Requirement } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `Requirement` fixture builder — roadmap/02 work item 10. */
export function buildRequirement(overrides: Partial<Requirement> = {}): Requirement {
  const ctx = createFixtureContext();
  const defaults: Requirement = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    intentContractId: ctx.ids.next(),
    section: "scope",
    title: "Deterministic fixture requirement",
    description: "A deterministic fixture requirement's description.",
    acceptanceCriteria: ["The fixture parses against RequirementSchema."],
    workUnitIds: [],
    renderedArtifactIds: [],
    testIdentifiers: [],
    evidenceRecordIds: [],
    createdAt: ctx.clock.next(),
  };
  return RequirementSchema.parse({ ...defaults, ...overrides });
}

import {
  CURRENT_SCHEMA_VERSION,
  RequirementSchema,
  computeCriteriaHash,
  type Requirement,
} from "@crabgic/contracts";
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
    criteriaHash: computeCriteriaHash(["The fixture parses against RequirementSchema."]),
    workUnitIds: [],
    renderedArtifactIds: [],
    testIdentifiers: [],
    evidenceRecordIds: [],
    createdAt: ctx.clock.next(),
  };
  // Overriding `acceptanceCriteria` alone must not silently produce a
  // self-inconsistent seal, so the hash is re-derived from whatever criteria
  // survive the merge. An explicit `criteriaHash` override still wins — a
  // test that WANTS a tampered record must be able to build one.
  const merged = { ...defaults, ...overrides };
  return RequirementSchema.parse({
    ...merged,
    criteriaHash: overrides.criteriaHash ?? computeCriteriaHash(merged.acceptanceCriteria),
  });
}

import { CURRENT_SCHEMA_VERSION, StackEvidenceSchema, type StackEvidence } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `StackEvidence` fixture builder — roadmap/02 work item 10. */
export function buildStackEvidence(overrides: Partial<StackEvidence> = {}): StackEvidence {
  const ctx = createFixtureContext();
  const defaults: StackEvidence = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    createdAt: ctx.clock.next(),
    findings: [
      {
        category: "manifest",
        ecosystem: "node",
        detail: "package.json present at repo root",
        path: "package.json",
        confidence: 0.9,
      },
    ],
    contradictions: [],
    unresolvedAmbiguity: [],
  };
  return StackEvidenceSchema.parse({ ...defaults, ...overrides });
}

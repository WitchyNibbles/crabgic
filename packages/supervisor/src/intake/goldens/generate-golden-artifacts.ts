/**
 * Golden intake-artifact generation — roadmap/11-intake-contract-approval.md
 * §Test plan, Conformance. Mirrors `packages/engine-core/src/goldens/
 * generate-golden-artifacts.ts`'s own documented convention: pure in-memory
 * build (no filesystem I/O here), `JSON.stringify(value, null, 2)` plus
 * exactly one trailing newline, stable key order (every builder's object
 * literals are always constructed field-by-field in the same fixed order).
 */
import { buildIntakeArtifacts } from "../intake-pipeline.js";
import { FIXTURE_INTAKE_REQUEST } from "./fixture-request.js";

export interface GoldenArtifact {
  readonly relativePath: string;
  readonly content: string;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Builds the 4 named golden artifacts roadmap/11's own Conformance test-plan item names verbatim, plus the 2 supporting ones (`requirements`, the provisional performance contract) this phase's assembly also produces. */
export function buildGoldenIntakeArtifacts(): readonly GoldenArtifact[] {
  const artifacts = buildIntakeArtifacts(FIXTURE_INTAKE_REQUEST);
  return [
    { relativePath: "intent-contract.json", content: serialize(artifacts.intentContract) },
    { relativePath: "requirements.json", content: serialize(artifacts.requirements) },
    {
      relativePath: "work-unit-graph.json",
      content: serialize({
        workUnits: artifacts.workUnits,
        integrationOrder: artifacts.changeSet.integrationOrder,
      }),
    },
    { relativePath: "authorization-envelope.json", content: serialize(artifacts.envelope) },
    { relativePath: "capability-manifest.json", content: serialize(artifacts.capabilityManifest) },
    {
      relativePath: "provisional-performance-contract.json",
      content: serialize(artifacts.provisionalPerformanceContract),
    },
  ];
}

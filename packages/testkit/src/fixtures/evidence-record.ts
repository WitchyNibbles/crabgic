import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `EvidenceRecord` fixture builder — roadmap/02 work item 10. */
export function buildEvidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const ctx = createFixtureContext();
  const defaults: EvidenceRecord = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    command: "npm test",
    exitStatus: 0,
    toolchainFingerprint: "node@24.18.0",
    capturedAt: ctx.clock.next(),
    artifactDigests: ["sha256:deterministic-fixture-artifact-digest"],
    objectId: "0000000000000000000000000000000000000a",
  };
  return EvidenceRecordSchema.parse({ ...defaults, ...overrides });
}

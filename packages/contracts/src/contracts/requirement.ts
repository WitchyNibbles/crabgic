import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";
import { IntentContractSectionKeySchema } from "./intent-contract.js";

/**
 * `Requirement` (roadmap/02-contracts-and-schemas.md §Interfaces produced,
 * row "Requirement | 11 (assigns IDs), 14, 21"): a stable, individually
 * addressable requirement within an `IntentContract`
 * (`intentContractId` — cross-contract reference, never embedded).
 *
 * `section` ties each requirement to one of the 9 `IntentContract` sections
 * (../contracts/intent-contract.ts) — grounded by
 * roadmap/15-performance-contracts.md §In scope, "Budget sourcing" bullet:
 * "The ChangeSet's IntentContract `performance` section / Requirement
 * acceptance criteria (11, ...)" — 15 must be able to select the subset of
 * requirements belonging to the `performance` section specifically, which
 * requires this field.
 *
 * `acceptanceCriteria` is the field roadmap/15's same bullet calls
 * "Requirement acceptance criteria" — a non-empty list of free-text
 * criteria (minimal shape: no structured acceptance-criterion format is
 * pinned upstream).
 *
 * The 4 bidirectional-mapping arrays (`workUnitIds`, `renderedArtifactIds`,
 * `testIdentifiers`, `evidenceRecordIds`) implement roadmap/11 §In scope,
 * "Contract assembly" bullet's "bidirectional requirement ↔
 * work-unit/artifact/test/evidence mapping", and are the forward half of
 * roadmap/14-quality-security-gates.md's own exit criterion "`Requirement →
 * EvidenceRecord → exact object ID` resolves in both directions" — the
 * reverse half is each referenced contract's own back-reference (e.g. an
 * `EvidenceRecord.requirementId` field), not owned by this schema.
 * `renderedArtifactIds` targets `RenderedArtifact` (02's contract, owned
 * elsewhere) as "artifact" in the roadmap's mapping list. `testIdentifiers`
 * is free-text (test name/path), not `IdSchema`-typed, because no
 * standalone "Test" contract exists among this phase's 21 contracts —
 * individual test cases are stack-native test-framework identifiers, not
 * UUID-addressable entities in this system (minimal-shape choice).
 */
export const RequirementSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    intentContractId: IdSchema,
    section: IntentContractSectionKeySchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
    workUnitIds: z.array(IdSchema),
    renderedArtifactIds: z.array(IdSchema),
    testIdentifiers: z.array(NonEmptyStringSchema),
    evidenceRecordIds: z.array(IdSchema),
    createdAt: TimestampSchema,
  })
  .strict();
export type Requirement = z.infer<typeof RequirementSchema>;

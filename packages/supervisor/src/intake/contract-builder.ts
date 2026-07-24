/**
 * `IntentContract` + `Requirement` assembly — roadmap/11-intake-contract-
 * approval.md §In scope, "Contract assembly" bullet: "stable requirement
 * IDs; scope/non-goals/audience/compatibility/security/performance/
 * observability/rollout/acceptance; bidirectional requirement <->
 * work-unit/artifact/test/evidence mapping." The narrative section text
 * and the requirement drafts themselves are supplied by the caller — the
 * live manager-session drafting flow (`eo-explore`/`eo-reviewer`, 10) that
 * produces that narrative text is out of reach for a deterministic,
 * offline-testable TDD suite; this module is the deterministic assembly
 * step that flow's output feeds into (documented deviation, `docs/
 * evidence/phase-11/`).
 */
import {
  CURRENT_SCHEMA_VERSION,
  IntentContractSchema,
  RequirementSchema,
  type IntentContract,
  type IntentContractSectionKey,
  type IntentContractSections,
  type Requirement,
} from "@eo/contracts";
import { deriveStableId } from "./stable-id.js";

export interface RequirementDraft {
  readonly section: IntentContractSectionKey;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly workUnitIds?: readonly string[];
  readonly renderedArtifactIds?: readonly string[];
  readonly testIdentifiers?: readonly string[];
  readonly evidenceRecordIds?: readonly string[];
}

export interface BuildIntentContractOptions {
  readonly id: string;
  readonly changeSetId: string;
  readonly createdAt: string;
  readonly sections: IntentContractSections;
  readonly requirements: readonly RequirementDraft[];
}

export interface IntentContractAssembly {
  readonly intentContract: IntentContract;
  readonly requirements: readonly Requirement[];
}

/**
 * `Requirement.id`'s stable derivation seed: `section` + `title`, scoped to
 * `intentContractId` so identically-titled requirements in two distinct
 * contracts never collide. Re-inspecting the SAME contract with the SAME
 * drafted requirement always assigns the SAME id (roadmap/11 §Test plan,
 * "Requirement ID uniqueness/stability across re-inspection"). Exported (not
 * just internal to `buildIntentContract`) so a caller that needs to know a
 * requirement's id BEFORE calling this builder — e.g. `./goldens/fixture-
 * request.ts` wiring a real, non-degenerate `WorkUnit.requirementIds` <->
 * `Requirement.workUnitIds` mapping (LOW L6 repair) — computes the exact
 * same id this builder will assign, with no duplicated/drifting formula.
 */
export function computeRequirementId(
  intentContractId: string,
  draft: Pick<RequirementDraft, "section" | "title">,
): string {
  return deriveStableId(`requirement:${intentContractId}:${draft.section}:${draft.title}`);
}

/** Builds a schema-valid `IntentContract` plus its `Requirement` records, each with a stable, content-derived id. */
export function buildIntentContract(options: BuildIntentContractOptions): IntentContractAssembly {
  const requirements = options.requirements.map((draft) =>
    RequirementSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: computeRequirementId(options.id, draft),
      intentContractId: options.id,
      section: draft.section,
      title: draft.title,
      description: draft.description,
      acceptanceCriteria: [...draft.acceptanceCriteria],
      workUnitIds: [...(draft.workUnitIds ?? [])],
      renderedArtifactIds: [...(draft.renderedArtifactIds ?? [])],
      testIdentifiers: [...(draft.testIdentifiers ?? [])],
      evidenceRecordIds: [...(draft.evidenceRecordIds ?? [])],
      createdAt: options.createdAt,
    } satisfies Requirement),
  );

  const intentContract = IntentContractSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    changeSetId: options.changeSetId,
    createdAt: options.createdAt,
    sections: options.sections,
    requirementIds: requirements.map((r) => r.id),
  } satisfies IntentContract);

  return { intentContract, requirements };
}

import { randomUUID } from "node:crypto";
import {
  ChangeSetSchema,
  CURRENT_SCHEMA_VERSION,
  type ChangeSet,
  type LearningProposal,
} from "@eo/contracts";

export interface ChangeSetReferences {
  readonly intentContractId: string;
  readonly authorizationEnvelopeId: string;
  readonly capabilityManifestId: string;
  readonly provisionalPerformanceContractId: string;
  readonly integrationOrder?: readonly string[];
}

/**
 * Constructs a `ChangeSet` (02) representing a promoted lesson's rollout —
 * roadmap/22-learning-system.md §In scope, "Storage policy": "project-
 * scoped lesson promotion constructs a `ChangeSet` (02) dispatched through
 * the normal scheduler→gates→publish pipeline (13/14/08) — promoted
 * lessons clear the same verification as any human-authored change, never
 * a bypass."
 *
 * This function builds the OBJECT ONLY — dispatch through 13's scheduler,
 * 14's gates, and 08's publish pipeline is explicitly out of this phase's
 * scope (roadmap/22 §Out of scope: "ChangeSet publication and branch/
 * commit rendering — owned by 07/08; a promoted or rolled-back lesson
 * only constructs and hands off a `ChangeSet`"). The `intentContractId`/
 * `authorizationEnvelopeId`/`capabilityManifestId`/
 * `provisionalPerformanceContractId` cross-references are caller-supplied
 * (11's intake pipeline is the real constructor of those instances; this
 * phase does not reimplement intake) — see `../red-team/no-bypass.
 * redteam.test.ts` for the integration test proving the resulting
 * `ChangeSet` clears the SAME `@eo/gates` registry as any other change.
 */
export function buildChangeSetForPromotion(
  proposal: LearningProposal,
  refs: ChangeSetReferences,
  createdAt: string = new Date().toISOString(),
): ChangeSet {
  return ChangeSetSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    state: "draft",
    intentContractId: refs.intentContractId,
    authorizationEnvelopeId: refs.authorizationEnvelopeId,
    capabilityManifestId: refs.capabilityManifestId,
    provisionalPerformanceContractId: refs.provisionalPerformanceContractId,
    integrationOrder: [...(refs.integrationOrder ?? [])],
    rollbackStrategy: `Promoted learning proposal ${proposal.id}: revert the integration commit and restore prior behavior.`,
    createdAt,
  } satisfies ChangeSet);
}

/**
 * Constructs the INVERSE `ChangeSet` a `promoted -> rolled_back` transition
 * dispatches (roadmap/22 §In scope, "Expiry/rollback": "promoted-lesson
 * rollback dispatches an inverse `ChangeSet` through the same pipeline and
 * restores prior behavior with journaled rationale"). Same construction
 * shape as the forward `ChangeSet` — the "inverse" is expressed in
 * `rollbackStrategy`'s own text, since 02's `ChangeSet` schema has no
 * dedicated "this reverses ChangeSet X" field (out of this phase's
 * authority to add one to a frozen 02 contract).
 */
export function buildInverseChangeSetForRollback(
  proposal: LearningProposal,
  promotedChangeSetId: string,
  refs: ChangeSetReferences,
  createdAt: string = new Date().toISOString(),
): ChangeSet {
  return ChangeSetSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    state: "draft",
    intentContractId: refs.intentContractId,
    authorizationEnvelopeId: refs.authorizationEnvelopeId,
    capabilityManifestId: refs.capabilityManifestId,
    provisionalPerformanceContractId: refs.provisionalPerformanceContractId,
    integrationOrder: [...(refs.integrationOrder ?? [])],
    rollbackStrategy: `Inverse of ChangeSet ${promotedChangeSetId} (promoted learning proposal ${proposal.id}): restore the pre-promotion baseline.`,
    createdAt,
  } satisfies ChangeSet);
}

import { randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  DOCUMENT_CLAIMS_RESOLVE_CRITERION,
  DOCUMENT_FAILURE_MODES_CRITERION,
  DOCUMENT_USER_GUIDE_CRITERION,
  RequirementSchema,
  WorkUnitSchema,
  computeCriteriaHash,
  type Requirement,
  type WorkUnit,
} from "@crabgic/contracts";

/**
 * The documentation stage's dispatch hop — roadmap/25 WI 8, the half that was
 * missing.
 *
 * WHAT WAS ACTUALLY ABSENT. `DocumentationRecord` gave the stage derivable
 * criteria and `eo-documenter` gave it a planner, and both were built. Nothing
 * created a WORK UNIT — so the guides had a plan, a reviewer, exit criteria, and
 * no envelope-bounded worker to write them. A stage whose artifact nothing
 * produces cannot close, and the gap was invisible because every part around it
 * existed.
 *
 * WHY A WORK UNIT AND NOT A MANAGER WRITE. Guides are files in the repository,
 * so writing them is a write, and every write in this product goes through an
 * envelope-bounded worker in its own worktree (`docs/claude-code-adaptation.md`
 * §0 amendment 3: always workers, never the manager). This produces the unit;
 * the existing dispatch path (`driveRun` → `dispatchAttempt`) executes it, with
 * no new execution machinery and no second code path to keep in step.
 *
 * WHY THE OWNED PATHS ARE EXACTLY THE TWO GUIDES. Write ownership is what the
 * envelope's containment check tests. A documentation unit owning a source tree
 * would be a documentation worker able to edit the product it is describing —
 * and it would be able to make its own claims true by changing the code rather
 * than the guide.
 */

export interface DocumentationPlan {
  readonly changeSetId: string;
  /** The contract these guides serve — the `Requirement` must name one. */
  readonly intentContractId: string;
  readonly userGuidePath: string;
  readonly maintenanceGuidePath: string;
  /** Public commands and gateway tools the user guide must cover — from the SERVER's surface. */
  readonly commands: readonly string[];
  /** Operational failure modes the maintenance guide must answer — from the design. */
  readonly failureModes: readonly string[];
}

/**
 * Builds the acceptance criteria the worker is judged against.
 *
 * Every command and failure mode is named individually rather than summarised.
 * A criterion reading "document all commands" tells a worker nothing it can
 * check itself against, and the stage's derivations score the guide against the
 * server's surface item by item — so a unit dispatched with a summary would send
 * a worker to fail a check it could not see.
 */
function acceptanceCriteria(plan: DocumentationPlan): readonly string[] {
  return [
    `${DOCUMENT_USER_GUIDE_CRITERION}: ${plan.userGuidePath} documents each of these by name: ${plan.commands.join(", ")}.`,
    `${DOCUMENT_FAILURE_MODES_CRITERION}: ${plan.maintenanceGuidePath} tells an operator what they see and what they do for each of these: ${plan.failureModes.join(", ")}.`,
    `${DOCUMENT_CLAIMS_RESOLVE_CRITERION}: every command, path and flag either guide names must actually exist. Verify each against the code before naming it — a guide that invents one CONTRADICTS this criterion rather than merely missing it.`,
  ];
}

/**
 * The documentation work unit, plus the `Requirement` that carries its criteria.
 *
 * TWO RECORDS, NOT ONE, and the split is the existing architecture rather than a
 * choice made here. `WorkUnit` is `.strict()` and holds no criteria; criteria
 * live on a `Requirement`, and `run-dispatcher` resolves the unit's
 * `requirementIds` through the strict registry and copies the criteria onto the
 * `TaskPacket`. Returning both means the documentation stage travels the SAME
 * path as every other unit — no second dispatch route to keep in step, and the
 * criteria seal covers it for free.
 */
export interface DocumentationDispatch {
  readonly workUnit: WorkUnit;
  readonly requirement: Requirement;
}

export function buildDocumentationWorkUnit(
  plan: DocumentationPlan,
  newId: () => string = randomUUID,
  /** Injected so the record is deterministic under test, like `newId`. */
  createdAt: Date = new Date(),
): DocumentationDispatch {
  if (plan.userGuidePath === plan.maintenanceGuidePath) {
    throw new Error(
      "refusing to dispatch documentation: both guides name the same file, which would let the stage close with the maintenance guide absent",
    );
  }
  if (plan.commands.length === 0 && plan.failureModes.length === 0) {
    throw new Error(
      "refusing to dispatch documentation: nothing to document, so both coverage criteria would be satisfied vacuously",
    );
  }

  const criteria = acceptanceCriteria(plan);
  const requirementId = newId();
  const requirement: Requirement = RequirementSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: requirementId,
    intentContractId: plan.intentContractId,
    section: "acceptance",
    title: "User guide and maintenance guide",
    description:
      "The change set's guides, judged on coverage of the server's own surface and on whether every command they name exists.",
    acceptanceCriteria: [...criteria],
    // Computed, never supplied: phase 24's seal recomputes this and fails
    // closed on a mismatch, so a hand-written hash is a hash that will be
    // caught rather than one that will be believed.
    criteriaHash: computeCriteriaHash(criteria),
    workUnitIds: [],
    renderedArtifactIds: [],
    testIdentifiers: [],
    evidenceRecordIds: [],
    createdAt: createdAt.toISOString(),
  } satisfies Requirement);

  const workUnit: WorkUnit = WorkUnitSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId(),
    changeSetId: plan.changeSetId,
    title: "Write the user guide and the maintenance guide",
    requirementIds: [requirementId],
    /**
     * No dependencies: the documentation stage runs after `audit` closes, and
     * stage order is the driver's to enforce (`pipeline.plan`). Encoding it as
     * a DAG edge here would put one ordering rule in two places.
     */
    dependsOn: [],
    role: "documenter",
    ownedPaths: [plan.userGuidePath, plan.maintenanceGuidePath],
    attemptStatus: "pending",
  } satisfies WorkUnit);

  return { workUnit, requirement };
}

/**
 * Resolves the `ChangeSetReferences` a promoted lesson's `ChangeSet` is
 * built from, by binding to an intake that is ALREADY in flight.
 *
 * OWNER RULING (2026-07-25), which this module exists to implement: a
 * promoted lesson attaches to an ONGOING intake rather than requiring a
 * whole intake of its own. That resolves the question that blocked wiring
 * `learn approve` at all — `buildChangeSetForPromotion` needs four
 * cross-reference ids, `@eo/learning` deliberately does not reimplement
 * intake (11 owns constructing those instances), and supplying empty or
 * synthesized ids would have produced a `ChangeSet` pointing at nothing
 * while still passing its own schema. A lesson now rides work the operator
 * already authorized, and clears the same gates that work does.
 *
 * Every failure here is a refusal, never a fallback. There is no safe
 * default: inventing references would silently detach a promotion from any
 * real authorization, which is precisely the bypass roadmap/22 forbids.
 */
import type { ChangeSet, RunLifecycleState } from "@eo/contracts";
import type { ChangeSetReferences } from "@eo/learning";

/**
 * The states in which an intake is genuinely in flight and a lesson may
 * ride it.
 *
 * `draft` and `awaiting_approval` are deliberately EXCLUDED even though
 * they are non-terminal: their `AuthorizationEnvelope` has not been
 * approved yet, and a promoted lesson must never inherit an authorization
 * a human has not granted. `published_local`/`failed`/`cancelled` are
 * terminal — there is no longer any work to join.
 */
export const ONGOING_INTAKE_STATES: readonly RunLifecycleState[] = [
  "ready",
  "running",
  "verifying",
  "integrating",
  "final_verifying",
];

export class NoOngoingIntakeError extends Error {
  constructor() {
    super(
      "learn: no intake is currently in flight, so a promoted lesson has nothing to attach to. " +
        "A promotion rides an existing, approved ChangeSet (one of: " +
        `${ONGOING_INTAKE_STATES.join(", ")}) — start or approve one first.`,
    );
    this.name = "NoOngoingIntakeError";
  }
}

export class AmbiguousOngoingIntakeError extends Error {
  readonly changeSetIds: readonly string[];

  constructor(changeSetIds: readonly string[]) {
    super(
      `learn: ${String(changeSetIds.length)} intakes are in flight (${changeSetIds.join(", ")}), ` +
        "so which one a promoted lesson should ride is ambiguous. Refusing rather than " +
        "attaching the lesson to work that was not chosen.",
    );
    this.name = "AmbiguousOngoingIntakeError";
    this.changeSetIds = changeSetIds;
  }
}

/**
 * Reads the one in-flight `ChangeSet` and returns its references verbatim.
 * Throws `NoOngoingIntakeError` when none is in flight and
 * `AmbiguousOngoingIntakeError` when more than one is.
 */
export function resolveOngoingIntakeRefs(changeSets: {
  list: () => readonly ChangeSet[];
}): ChangeSetReferences {
  const ongoing = changeSets.list().filter((cs) => ONGOING_INTAKE_STATES.includes(cs.state));

  if (ongoing.length === 0) throw new NoOngoingIntakeError();
  if (ongoing.length > 1) throw new AmbiguousOngoingIntakeError(ongoing.map((cs) => cs.id));

  const changeSet = ongoing[0]!;
  return {
    intentContractId: changeSet.intentContractId,
    authorizationEnvelopeId: changeSet.authorizationEnvelopeId,
    capabilityManifestId: changeSet.capabilityManifestId,
    provisionalPerformanceContractId: changeSet.provisionalPerformanceContractId,
    integrationOrder: changeSet.integrationOrder,
  };
}

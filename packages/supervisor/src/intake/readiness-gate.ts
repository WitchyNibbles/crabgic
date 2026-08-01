/**
 * The `ready` gate — roadmap/11-intake-contract-approval.md §Exit criteria:
 * "Unmapped requirement blocks the `ready` transition (unit test against
 * 02's state machine)." Called on a successful `contract.approve`
 * verification (`packages/cli`'s handler) — the ONLY path that ever moves a
 * `ChangeSet` from `awaiting_approval` to `ready`.
 */
import type { ChangeSet, Requirement } from "@crabgic/contracts";
import { journalCriteriaSeal, type JournalStore } from "@crabgic/journal";
import type { Registry } from "../registries/registry.js";
import { findUnmappedRequirements } from "./dag-builder.js";
import { transitionChangeSet } from "./change-set-transition.js";

export class UnmappedRequirementError extends Error {
  readonly requirementIds: readonly string[];
  constructor(requirementIds: readonly string[]) {
    super(
      `intake: cannot transition to ready — ${requirementIds.length} requirement(s) have no owning WorkUnit: ${requirementIds.join(", ")}`,
    );
    this.name = "UnmappedRequirementError";
    this.requirementIds = requirementIds;
  }
}

/** A requirement the contract declares but whose record was not supplied — so its criteria cannot be sealed, so the ChangeSet cannot be approved. */
export class UnsealableRequirementError extends Error {
  readonly requirementIds: readonly string[];
  constructor(requirementIds: readonly string[]) {
    super(
      `intake: cannot transition to ready — ${requirementIds.length} declared requirement(s) have no record to seal: ${requirementIds.join(", ")}`,
    );
    this.name = "UnsealableRequirementError";
    this.requirementIds = requirementIds;
  }
}

export interface TransitionChangeSetToReadyOptions {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly changeSetId: string;
  readonly requirementIds: readonly string[];
  readonly workUnits: readonly { readonly requirementIds: readonly string[] }[];
  /**
   * The `Requirement` records themselves — roadmap/24. REQUIRED, and that is
   * the whole point: this is the ONE funnel both activation paths already
   * share, so sealing here makes `ready` unreachable without a seal by
   * construction. Sealing in each caller instead is precisely the shape the
   * donor's first completion seal shipped with: one path threaded it, the
   * daemon path did not, and every test injected the option so nothing
   * caught it.
   *
   * Defaults to `[]` for no caller — an optional parameter here would mean a
   * caller that forgot it silently produced an unsealed `ready` ChangeSet,
   * the same trap `RunIntakeCommandDeps.loadPolicy` was fixed for.
   */
  readonly requirements: readonly Requirement[];
}

/**
 * Validates requirement coverage BEFORE calling the real state-machine
 * transition (`./change-set-transition.js`) — an unmapped requirement
 * throws `UnmappedRequirementError` and `transitionChangeSet` (hence the
 * underlying `runLifecycleTransition` validator) is NEVER invoked; no
 * journal write happens either. Full coverage delegates straight through
 * to `transitionChangeSet(..., to: "ready")`, so every OTHER failure mode
 * (illegal transition, unknown ChangeSet) still surfaces via that same,
 * single state-machine surface.
 */
export async function transitionChangeSetToReady(
  options: TransitionChangeSetToReadyOptions,
): Promise<ChangeSet> {
  const unmapped = findUnmappedRequirements(options.requirementIds, options.workUnits);
  if (unmapped.length > 0) {
    throw new UnmappedRequirementError(unmapped);
  }

  // Every declared requirement must have a record to seal. A missing one is
  // refused HERE rather than tolerated: an incomplete seal would read as
  // `no_approval_seal` at completion time, turning an approval-time
  // bookkeeping gap into an unexplainable mid-run refusal.
  const byId = new Map(options.requirements.map((requirement) => [requirement.id, requirement]));
  const unsealable = options.requirementIds.filter((id) => !byId.has(id));
  if (unsealable.length > 0) {
    throw new UnsealableRequirementError(unsealable);
  }

  // Journaled BEFORE the transition, matching the standing-approval path's own
  // ordering rationale: a crash between the two leaves evidence that the
  // criteria were sealed, rather than a `ready` ChangeSet nothing accounts for.
  await journalCriteriaSeal(options.journal, {
    changeSetId: options.changeSetId,
    criteriaHashes: Object.fromEntries(
      options.requirementIds.map((id) => [id, byId.get(id)!.criteriaHash]),
    ),
  });

  return transitionChangeSet({
    journal: options.journal,
    changeSets: options.changeSets,
    changeSetId: options.changeSetId,
    to: "ready",
  });
}

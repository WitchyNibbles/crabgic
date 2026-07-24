/**
 * The `ready` gate — roadmap/11-intake-contract-approval.md §Exit criteria:
 * "Unmapped requirement blocks the `ready` transition (unit test against
 * 02's state machine)." Called on a successful `contract.approve`
 * verification (`packages/cli`'s handler) — the ONLY path that ever moves a
 * `ChangeSet` from `awaiting_approval` to `ready`.
 */
import type { ChangeSet } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";
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

export interface TransitionChangeSetToReadyOptions {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly changeSetId: string;
  readonly requirementIds: readonly string[];
  readonly workUnits: readonly { readonly requirementIds: readonly string[] }[];
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

  return transitionChangeSet({
    journal: options.journal,
    changeSets: options.changeSets,
    changeSetId: options.changeSetId,
    to: "ready",
  });
}

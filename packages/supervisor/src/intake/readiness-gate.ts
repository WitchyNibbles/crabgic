/**
 * The `ready` gate — roadmap/11-intake-contract-approval.md §Exit criteria:
 * "Unmapped requirement blocks the `ready` transition (unit test against
 * 02's state machine)." Called on a successful `contract.approve`
 * verification (`packages/cli`'s handler) — the ONLY path that ever moves a
 * `ChangeSet` from `awaiting_approval` to `ready`.
 */
import {
  stageCompleted,
  type ChangeSet,
  type Requirement,
  type StageCompletionRecord,
} from "@crabgic/contracts";
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

/**
 * The design gate has not closed for this ChangeSet — owner ruling R8 (2026-08-16).
 *
 * Ruling R2 placed the `design-gate` "before dispatch". Measured 2026-08-16, it
 * was not: `resolveDesignGate` had zero references anywhere in the run path, so
 * the gate decided only whether a review STAGE could close and nothing consulted
 * it before dispatching
 * (`docs/evidence/criteria-closeout/defects/25-design-gate-not-consulted-by-dispatch.md`).
 *
 * R8 binds the run path to the PIPELINE rather than to the verdict store
 * directly, so this asks whether the stage closed — which for that one stage is
 * answerable only by an `OwnerDesignVerdict`, which only the CLI can write.
 *
 * Refused HERE because `transitionChangeSetToReady` is the only path from
 * `awaiting_approval` to `ready`, and `ready` is what dispatch requires. The
 * seven stop conditions stay unchanged in number and meaning, and ledger Gap
 * 18's containment check is untouched: a precondition on dispatch is not a
 * widening of what may execute.
 */
export class DesignGateNotClosedError extends Error {
  readonly changeSetId: string;
  constructor(changeSetId: string) {
    super(
      `intake: cannot transition to ready — the design-gate stage has not closed for ChangeSet ${changeSetId}. ` +
        "Run the pipeline's design stage and record the owner's answer with `crabgic design approve`.",
    );
    this.name = "DesignGateNotClosedError";
    this.changeSetId = changeSetId;
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
  /**
   * Which pipeline stages have CLOSED for this ChangeSet — owner ruling R8.
   *
   * REQUIRED, for the same reason `requirements` above is: this is the one
   * funnel both activation paths share, so an optional field would let a caller
   * that forgot it produce a `ready` ChangeSet whose design nobody approved —
   * the very defect R8 exists to close, reintroduced one layer up.
   *
   * Supplied by the caller because the STORE lives in `packages/cli` and the
   * package graph runs cli -> supervisor. The PREDICATE (`stageCompleted`) is in
   * `@crabgic/contracts`, which both already depend on, so the two sides cannot
   * disagree about what "closed" means even though the storage is not shared.
   */
  readonly stageCompletions: readonly StageCompletionRecord[];
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
  /**
   * Checked FIRST, and before the seal, on the same ordering discipline the
   * unmapped-requirement check follows: a refused transition must leave no
   * journal record implying the run got further than it did.
   *
   * Absence reads as NOT CLOSED — no records, another ChangeSet's records, some
   * other stage's records. Refusing to start work nobody approved is the correct
   * answer whenever the answer is unknown.
   */
  if (!stageCompleted(options.stageCompletions, options.changeSetId, "design-gate")) {
    throw new DesignGateNotClosedError(options.changeSetId);
  }

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

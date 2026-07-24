/**
 * DAG builder — roadmap/11-intake-contract-approval.md §In scope, "Planning
 * outputs" bullet: "decision-complete DAG, roster (role -> model, balanced
 * routing), write ownership, integration order, rollback strategy." §Exit
 * criteria: "Unmapped requirement blocks the `ready` transition (unit test
 * against 02's state machine)."
 *
 * Requirement-coverage is DELIBERATELY not enforced by `buildWorkUnitGraph`
 * itself — a `ChangeSet` may legitimately sit in `draft`/`awaiting_approval`
 * with a work-in-progress DAG that doesn't yet cover every requirement
 * (roadmap/11 §In scope, "ChangeSet lifecycle" bullet only requires
 * completion by `awaiting_approval`, not full coverage at draft time). The
 * exit criterion's own wording — "blocks the READY transition" — is
 * enforced at that later point instead, by `./readiness-gate.ts`'s
 * `transitionChangeSetToReady`, which calls `findUnmappedRequirements`
 * (this module) immediately before invoking the real state-machine
 * transition and fails closed without ever reaching it if coverage is
 * incomplete.
 *
 * Model-routing itself ("balanced routing") is 13's own algorithm
 * (roadmap/13-scheduler-packets-context.md §In scope, "Model routing: role
 * -> alias map ... resolved at dispatch time") — out of scope here. This
 * builder records whichever role -> model pin the caller supplies
 * (11's approval-preview render shows it to the human as a plan snapshot)
 * without computing the routing decision itself; a minimal-shape choice
 * documented in `docs/evidence/phase-11/`.
 */
import { CURRENT_SCHEMA_VERSION, WorkUnitSchema, type WorkUnit } from "@eo/contracts";

export interface WorkUnitDraft {
  readonly id: string;
  readonly title: string;
  readonly requirementIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly role: string;
  readonly ownedPaths: readonly string[];
}

export interface BuildWorkUnitGraphOptions {
  readonly changeSetId: string;
  readonly requirementIds: readonly string[];
  readonly workUnits: readonly WorkUnitDraft[];
}

export interface WorkUnitGraph {
  readonly workUnits: readonly WorkUnit[];
  /** Topologically-sorted `WorkUnit` id order — 02's DAG, integration-order field on `ChangeSet`. */
  readonly integrationOrder: readonly string[];
}

/** Every requirement id in `requirementIds` not referenced by any `WorkUnit.requirementIds` — the READY-gate's own coverage check (`./readiness-gate.ts`); exported so both that gate and this module's own tests can assert on it directly. */
export function findUnmappedRequirements(
  requirementIds: readonly string[],
  workUnits: readonly { readonly requirementIds: readonly string[] }[],
): readonly string[] {
  const covered = new Set(workUnits.flatMap((wu) => wu.requirementIds));
  return requirementIds.filter((id) => !covered.has(id));
}

export class CyclicWorkUnitGraphError extends Error {
  constructor(remaining: readonly string[]) {
    super(`intake: WorkUnit dependency graph has a cycle among: ${remaining.join(", ")}`);
    this.name = "CyclicWorkUnitGraphError";
  }
}

/** Kahn's-algorithm topological sort over `dependsOn` edges. Throws `CyclicWorkUnitGraphError` if a cycle exists. Deterministic: ties broken by input order. */
function topologicalSort(workUnits: readonly WorkUnitDraft[]): readonly string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const wu of workUnits) {
    inDegree.set(wu.id, inDegree.get(wu.id) ?? 0);
    for (const dep of wu.dependsOn) {
      inDegree.set(wu.id, (inDegree.get(wu.id) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(wu.id);
      dependents.set(dep, list);
    }
  }

  const queue = workUnits.filter((wu) => (inDegree.get(wu.id) ?? 0) === 0).map((wu) => wu.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (order.length !== workUnits.length) {
    const remaining = workUnits.map((wu) => wu.id).filter((id) => !order.includes(id));
    throw new CyclicWorkUnitGraphError(remaining);
  }
  return order;
}

/**
 * Builds the (possibly still-incomplete) `WorkUnit` DAG. Throws
 * `CyclicWorkUnitGraphError` for a non-DAG `dependsOn` graph — acyclicity
 * IS enforced at build time, unlike requirement coverage (see this
 * module's own file-level doc comment for why coverage is checked later,
 * at the `ready` gate, via `findUnmappedRequirements`).
 */
export function buildWorkUnitGraph(options: BuildWorkUnitGraphOptions): WorkUnitGraph {
  const integrationOrder = topologicalSort(options.workUnits);

  const workUnits = options.workUnits.map((draft) =>
    WorkUnitSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: draft.id,
      changeSetId: options.changeSetId,
      title: draft.title,
      requirementIds: [...draft.requirementIds],
      dependsOn: [...draft.dependsOn],
      role: draft.role,
      ownedPaths: [...draft.ownedPaths],
      attemptStatus: "pending",
    } satisfies WorkUnit),
  );

  return { workUnits, integrationOrder };
}

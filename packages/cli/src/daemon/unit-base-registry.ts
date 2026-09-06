import type { RunBaseResolution } from "./red-baseline-tree.js";

/**
 * The one place a daemon answers "what base was THIS work unit cut from?" —
 * owner ruling 2026-09-06, "chain the base": a unit whose dependencies have all
 * succeeded is cut from their integrated tip, not from the run's frozen base.
 *
 * ⚠️ EXTRACTED SO THE DISCRIMINATION IS REACHABLE. As two private maps and a
 * closure inside `createRealRunDispatcher`, the per-unit answer could be
 * reverted to the run-scoped one (`return run;`) with the whole suite still
 * green: the only consumers are gate-surface members that a no-repository
 * fixture never reaches, because the per-work-unit gate firing fails closed on
 * the FIRST unit and a dependent unit's gates never fire behind it. Both halves
 * being separately correct is not the same fact as the seam between them being
 * correct — the same correction `./red-baseline-tree.ts`'s `createBaseTreeSurface`
 * carries, one round earlier.
 *
 * SAME-DAEMON ONLY, exactly like the retained worktrees this is keyed beside. A
 * restart loses it, and `resolve` then answers `undefined` for a run this
 * daemon does not hold — which the gates already treat as "not measured"
 * rather than as a pass.
 */
export interface UnitBaseRegistry {
  /**
   * Records a run's frozen base and control clone, keyed by CHANGE SET because
   * that is what a `GateContext` carries; a run id would be unreachable from a
   * gate firing.
   */
  openRun(
    changeSetId: string,
    run: { readonly runId: string; readonly baseObjectId: string; readonly controlDir: string },
  ): void;
  /**
   * The chained bases this run has resolved so far, created on first ask and
   * RETAINED ACROSS RE-DRIVES.
   *
   * ⚠️ Re-resolving is not idempotent for a unit with two or more predecessors:
   * the fold BUILDS a commit, and a second fold of the same trees yields a
   * different object id. A unit resumed on a later drive would then be
   * collected against a base its worktree was never cut at.
   *
   * Mutable by design — the drive writes each unit's base into it as it
   * resolves, and hands the same map to the post-completion pipeline.
   */
  chainedBasesFor(runId: string): Map<string, string>;
  /**
   * What the GATES read: this unit's own base, falling back to the run's freeze
   * for a unit with no resolved chain (every unit of a dependency-free DAG, and
   * every unit of every run before chaining existed).
   */
  resolve(changeSetId: string, workUnitId: string): RunBaseResolution | undefined;
  /** Drops one run's chained bases. The run's frozen base is left keyed by change set, where a later run overwrites it. */
  closeRun(runId: string): void;
}

export function createUnitBaseRegistry(): UnitBaseRegistry {
  const runByChangeSetId = new Map<
    string,
    { readonly runId: string; readonly baseObjectId: string; readonly controlDir: string }
  >();
  /**
   * ⚠️ KEYED BY RUN, NOT BY CHANGE SET, AND CLEARED WITH THE RUN. Work-unit ids
   * are stable across runs of the same change set — a retry is a fresh run over
   * the same registry-stored units — so a change-set-keyed map would answer a
   * NEW run's gate firing with a CANCELLED run's commit. The control clone is
   * per project, so that object still resolves and the diff is silently wrong
   * rather than absent, which is the worse failure.
   */
  const chainedByRun = new Map<string, Map<string, string>>();

  return {
    openRun(changeSetId, run) {
      runByChangeSetId.set(changeSetId, run);
    },
    chainedBasesFor(runId) {
      const existing = chainedByRun.get(runId);
      if (existing !== undefined) return existing;
      const created = new Map<string, string>();
      chainedByRun.set(runId, created);
      return created;
    },
    resolve(changeSetId, workUnitId) {
      const run = runByChangeSetId.get(changeSetId);
      if (run === undefined) return undefined;
      const chained = chainedByRun.get(run.runId)?.get(workUnitId);
      return chained === undefined
        ? { baseObjectId: run.baseObjectId, controlDir: run.controlDir }
        : { baseObjectId: chained, controlDir: run.controlDir };
    },
    closeRun(runId) {
      chainedByRun.delete(runId);
    },
  };
}

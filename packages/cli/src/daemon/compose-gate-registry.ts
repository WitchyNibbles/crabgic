/**
 * The production composition root for phase 14's gate registry — the consumer
 * `packages/gates` never had.
 *
 * WHY THIS FILE EXISTS. Defect `14-gate-registry-never-composed.md`:
 * `createGateRegistry` had **zero production call sites**, so every
 * `register…Gate` function in the repository added a handler to an object no
 * production code owned, and `fireAll`/`fireByTag` had no production caller to
 * read them back. This is the missing half. It is deliberately the ONLY place
 * in production code that calls `createGateRegistry`.
 *
 * ONE SHARED INSTANCE, NEVER A SECOND COPY — the same discipline
 * `composeSupervisor` already applies to its registries and `liveWorkers`. The
 * dispatcher builds one registry per dispatcher and hands the SAME instance to
 * every firing, so `list()` answers for the whole process and a second
 * registry cannot silently shadow the first.
 *
 * NOT AN INJECTABLE SEAM. `../daemon/run-dispatcher.ts` calls this
 * unconditionally and exposes no option to substitute a registry. That is the
 * load-bearing design rule of this whole change: a seam above the gate firing
 * would let a test supply its own registry and pass while production registered
 * nothing — which is precisely the harness-only reach the defect record
 * documents. Git effects below the firing ARE injectable
 * (`./post-completion-git-effects.ts`); the registry, the firing, and the
 * verdict → lifecycle mapping are not.
 *
 * WHAT IS REGISTERED, AND WHAT IS NOT. Exactly one gate today: phase 24's
 * criteria-seal gate. Its inputs are already composed in the daemon (the
 * journal plus the requirements registry, both required members of
 * `SupervisorDependencies`) and it is a PURE read — no subprocess, no
 * measurement, no capability store, no engine — which is what makes firing it
 * in the daemon process defensible while roadmap/14 WI6's `TaskPacket`-dispatch
 * half stays deferred. Every other shipped handler is deliberately absent:
 *
 *   - 14's own `tdd`/`coverage`/`flake`/`security`/`engine-conformance` gates
 *     need coverage reports, digest-pinned scanner binaries from 12's
 *     capability store, and journaled green `engine-live` records — none of
 *     which the daemon composes.
 *   - 15's performance gate needs a production `getProvisionalContract`, a
 *     twin-worktree A/B measurement runner meeting its own
 *     `MIN_INTERLEAVED_REPETITIONS` methodology floor, and stack commands from
 *     an uncomposed `ProjectProfile` — an M-to-L package of its own. Registering
 *     it here would be a handler that throws or fabricates measurements.
 *
 * Each of those needs a worker sandbox to execute stack commands in, i.e. WI6's
 * `TaskPacket` dispatch, before registering it would be honest.
 * {@link COMPOSED_GATE_NAMES} pins the current set so adding one announces
 * itself in `./compose-gate-registry.test.ts` rather than drifting in silently.
 */
import { createGateRegistry, registerCriteriaSealGate, type GateRegistry } from "@crabgic/gates";
import type { Requirement, WorkUnit } from "@crabgic/contracts";
import { resolveRequirementsStrict, type SupervisorDependencies } from "@crabgic/supervisor";

/**
 * The gates this composition root registers, in registration order.
 *
 * A pinned residual, not documentation: `./compose-gate-registry.test.ts`
 * asserts deep equality against the composed registry's own `list()`, so a
 * future registration reddens that test and has to be acknowledged. A `toContain`
 * would have let a silent addition through.
 */
export const COMPOSED_GATE_NAMES: readonly string[] = Object.freeze(["criteria-seal"]);

/** What the registry needs from the daemon's dependency bundle — a narrow slice, so this cannot reach for anything else. */
export type GateRegistryDependencies = Pick<SupervisorDependencies, "requirements" | "workUnits">;

/**
 * Every requirement id declared by any work unit of `changeSetId`, deduped in
 * first-seen order.
 *
 * The seal gate's own job is the WHOLE ChangeSet's requirement set — "a tamper
 * landing after a unit already passed is invisible to that unit's own completed
 * check and visible here" (`packages/gates/src/criteria-seal-gate.ts`). A
 * per-unit id list would reproduce exactly the blind spot the gate exists to
 * cover, so the union is what this resolves.
 */
export function changeSetRequirementIds(
  workUnits: Pick<GateRegistryDependencies["workUnits"], "query">,
  changeSetId: string,
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const unit of workUnits.query(
    (candidate: WorkUnit) => candidate.changeSetId === changeSetId,
  )) {
    for (const id of unit.requirementIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Builds the one `GateRegistry` this daemon fires.
 *
 * The requirements reader is a FUNCTION evaluated when the gate fires, never a
 * snapshot taken at registration — reading at registration would pin the bar as
 * it stood before the work ran, which is exactly the window a tamper lives in.
 *
 * STRICT resolution, deliberately, matching the dispatch/park-resume seams
 * (`./run-dispatcher.ts`, and the 2026-08-04 ruling recorded there): a declared
 * requirement id that resolves to no record is a REFUSAL, not an empty bar. The
 * throw propagates out of `fireAll` and the pipeline maps it to a run-level
 * failure — an unresolvable declared id means the run's acceptance basis is
 * incoherent, which is an integrity failure of its INPUTS rather than a verdict
 * on any unit's output. Dropping unresolvable ids here would let a deleted
 * `requirements.json` silently downgrade a sealed acceptance bar to no bar at
 * all, and this gate is the last place that could still notice.
 */
export function composeGateRegistry(deps: GateRegistryDependencies): GateRegistry {
  const registry = createGateRegistry();
  registerCriteriaSealGate(registry, {
    requirements: (context): readonly Requirement[] =>
      resolveRequirementsStrict(
        deps.requirements,
        changeSetRequirementIds(deps.workUnits, context.changeSetId),
        context.changeSetId,
      ),
  });
  return registry;
}

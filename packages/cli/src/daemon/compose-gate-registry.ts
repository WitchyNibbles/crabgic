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
 * WHAT IS REGISTERED, AND WHAT IS NOT. The admission test was: a gate may fire
 * in the daemon PROCESS only if it executes no stack command, because
 * roadmap/14 WI6's `TaskPacket`/worker-sandbox dispatch was the precondition for
 * anything that does (`./post-completion-pipeline.ts`, the deviation note in its
 * header).
 *
 * ⚠️ THAT RULE NOW HAS ONE STATED EXCEPTION, AND ITS PREMISE IS WHAT CHANGED.
 * The rule existed because nothing in the daemon could run a project's own
 * tests, so any gate needing one would have had to fabricate a measurement.
 * Owner decision 2026-08-18 — "harness runs it pre-dispatch" — gives the daemon
 * that ability, bounded by the run's approved `AuthorizationEnvelope`: it runs
 * the `acceptance`-class command the owner granted, in the attempt's own
 * worktree, on the same authority the worker beside it already holds. The rule
 * still binds every gate whose BACKEND is missing, which is all of the ones
 * listed as absent below.
 *
 *   - **Phase 24's criteria-seal gate**, under `acceptance`. Its inputs are
 *     already composed in the daemon (the journal plus the requirements
 *     registry, both required members of `SupervisorDependencies`) and it is a
 *     PURE read — no subprocess, no measurement, no capability store, no
 *     engine.
 *   - **Phase 21's six security fixtures**, under `security`, via
 *     `registerSecurityFixtureManifest`. Roadmap/21 work item 6 asks for these
 *     to be "standing, blocking entries in 14's gate manifest rather than
 *     one-off phase-exit tests"
 *     (`roadmap/21-connector-evidence-integration.md:21`); until they were
 *     registered here, `registerSecurityFixtureManifest` had exactly ONE caller
 *     in the repository and it was `packages/gates`' own unit test, so
 *     "standing" was true of a test harness and of nothing that ships. Each
 *     `verify` is a pure in-memory check of the installed build's own security
 *     primitives — a refused `issue.delete`, the absence of forged operations
 *     on the Grafana adapter surface, a tenant-boundary scenario over an
 *     in-memory fake transport, three redaction round-trips. No subprocess, no
 *     network, no filesystem, no engine, so they clear the same admission test
 *     the seal gate does.
 *
 *     HONEST SCOPE. These six verdicts do not depend on the candidate
 *     `objectId`; they are install-integrity self-checks. The `EvidenceRecord`
 *     each firing emits therefore attests "at the moment candidate X was
 *     verified for publication, the platform's own security fixtures held" —
 *     not a property of X's diff. That is what WI6 designed, and it is a weaker
 *     claim than the seal gate's, so it is stated rather than left for a
 *     reviewer to discover.
 *
 * Every other shipped handler is deliberately absent, and each absence has a
 * measured cause rather than an intention:
 *
 *   - 14's own `tdd`/`coverage`/`flake`/scanner/`engine-conformance` gates
 *     need coverage reports, digest-pinned scanner binaries from 12's
 *     capability store, and journaled green `engine-live` records — none of
 *     which the daemon composes, and the last of which is owner-gated
 *     (`engine-live.yml` has never run).
 *
 *     COVERAGE, specifically, and why owner ruling R6 did NOT change this.
 *     R6 gave that gate a changed-line check (`packages/gates`'
 *     `coverage/changed-line-coverage.ts`) so it scores the CHANGE rather than
 *     the repository. What it did not and could not give it is an input: the
 *     gate takes a `CoverageSummary`, producing one means running the project's
 *     test suite, and running a stack command in the daemon process is what the
 *     admission test above forbids. So the gate is better and still absent, and
 *     the precondition is unchanged — roadmap/14 WI6's `TaskPacket` dispatch.
 *     Registering it today would mean a handler with nothing to measure.
 *   - 15's performance gate needs a production `getProvisionalContract`, a
 *     twin-worktree A/B measurement runner meeting its own
 *     `MIN_INTERLEAVED_REPETITIONS` methodology floor, and stack commands from
 *     an uncomposed `ProjectProfile` — an M-to-L package of its own. Registering
 *     it here would be a handler that throws or fabricates measurements.
 *     `docs/interface-ledger.md` records, twice, that
 *     `createPerformanceGateHandler` has no production caller; registering it
 *     is therefore also a coordinated ledger amendment, not a one-line change.
 *
 * The stack-command rule is why that list did not shrink further in the same
 * change that added the security tranche: `fireAll` fires EVERY registered gate
 * for EVERY run, so a handler without a real backend does not degrade
 * gracefully — it fails every run in every deployment, or it fabricates.
 * {@link COMPOSED_GATE_NAMES} pins the current set so adding a gate family
 * announces itself in `./compose-gate-registry.test.ts` rather than drifting in
 * silently.
 */
import {
  ACCEPTANCE_EVALUATED_GATE_NAME,
  createGateRegistry,
  registerAcceptanceEvaluatedGate,
  registerCriteriaSealGate,
  registerSecurityFixtureManifest,
  registerTddGate,
  REQUIRED_SECURITY_FIXTURE_IDS,
  runGrantedAcceptanceCommand,
  TDD_GATE_NAME,
  type GateContext,
  type GateRegistry,
} from "@crabgic/gates";
import type { Requirement, WorkUnit } from "@crabgic/contracts";
import { resolveRequirementsStrict, type SupervisorDependencies } from "@crabgic/supervisor";

/**
 * The gates this composition root registers, in `list()` order — which is
 * `GATE_RISK_TAGS` order, NOT registration order.
 *
 * `createGateRegistry().list()` flattens its tag map in the order
 * `packages/gates/src/risk-tags.ts` declares, and that file puts `security`
 * (index 4) before `acceptance` (index 8). So the security tranche precedes
 * `criteria-seal` here even though `composeGateRegistry` registers the seal
 * gate first. `./compose-gate-registry.test.ts` pins that ordering directly
 * against `list()`, so re-ordering the risk-tag vocabulary reddens rather than
 * silently re-shuffling this constant's meaning.
 *
 * A pinned residual, not documentation: the test asserts deep equality against
 * the composed registry's own `list()`, so a future registration reddens it and
 * has to be acknowledged. A `toContain` would have let a silent addition
 * through.
 *
 * WHY THIS IS DERIVED FROM `REQUIRED_SECURITY_FIXTURE_IDS` RATHER THAN A HARD
 * LITERAL — the ruling, recorded where the reader lands. The security tranche's
 * MEMBERSHIP is owned by `packages/gates/src/security-fixture-manifest.ts` and
 * pinned by that package's own completeness tests;
 * `registerSecurityFixtureManifest` loops over the manifest, so an entry added
 * there auto-registers here. A literal copy of the six names would make this
 * file a second, drifting source of truth for a list it does not own, and would
 * redden on a manifest change for no reason a reader of THIS file could act on.
 * What the announcement property is actually for is composition-root-level
 * change — adding a gate FAMILY — and deep equality against `list()` still
 * catches that. Membership is pinned where it lives; composition is pinned
 * here.
 */
export const COMPOSED_GATE_NAMES: readonly string[] = Object.freeze([
  ...REQUIRED_SECURITY_FIXTURE_IDS,
  "criteria-seal",
  ACCEPTANCE_EVALUATED_GATE_NAME,
  // `tdd` is index 9 in `GATE_RISK_TAGS` — after all nine IntentContract
  // sections — so it lands last in `list()` order regardless of when it is
  // registered below.
  TDD_GATE_NAME,
]);

/**
 * Run-scoped attempt state, read at FIRING time rather than at registration.
 *
 * ⚠️ WHY THIS INDIRECTION EXISTS. The registry is built once per dispatcher, at
 * startup, before any run has a change set or any attempt has a worktree. The
 * TDD gate needs both. A snapshot taken at registration would be empty forever,
 * and a second registry per run would break the "one shared instance, never a
 * second copy" rule this file's header states. So the dispatcher hands over a
 * READER it keeps current and the gate asks it when it fires — the same
 * discipline `registerCriteriaSealGate`'s requirements reader follows, for the
 * same reason: reading early pins a value from before the work ran.
 *
 * Both members answer `undefined` rather than throwing when they cannot answer.
 * The gate turns that into a blocking verdict, which is journaled; a throw out
 * of a handler leaves no record that the gate refused.
 */
export interface AttemptSurface {
  /** The isolated worktree of the named work unit's current attempt. */
  worktreePathFor(workUnitId: string): string | undefined;
  /** The commands the named change set's APPROVED `AuthorizationEnvelope` grants. Never a default and never a superset. */
  grantedCommandsFor(changeSetId: string): readonly string[] | undefined;
}

/** What the registry needs from the daemon's dependency bundle — a narrow slice, so this cannot reach for anything else. */
export type GateRegistryDependencies = Pick<
  SupervisorDependencies,
  "requirements" | "workUnits"
> & {
  readonly attempts: AttemptSurface;
};

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
/**
 * One work unit's OWN declared requirement ids.
 *
 * Deliberately not `changeSetRequirementIds`: the TDD gate judges one unit's
 * own attempt, and the ChangeSet union would demand a red baseline for every
 * sibling unit's requirements before this unit could pass.
 */
export function workUnitRequirementIds(
  workUnits: Pick<GateRegistryDependencies["workUnits"], "query">,
  workUnitId: string,
): readonly string[] {
  for (const unit of workUnits.query((candidate: WorkUnit) => candidate.id === workUnitId)) {
    return [...unit.requirementIds];
  }
  return [];
}

/**
 * Runs the candidate's own test suite — the GREEN half of the TDD gate.
 *
 * ⚠️ AN UNMEASURED CANDIDATE IS REPORTED AS FAILING, never as passing.
 * `CandidateTestRun` has no "could not run" member, so the honest encoding of
 * "the harness could not measure this" is a non-zero status with a command
 * string that says why — which the gate turns into a blocking verdict and
 * `emitEvidence` journals. Reporting `0` for an unmeasured candidate is the one
 * answer that would let a run publish unverified work, which is the failure
 * owner ruling R5 exists to refuse.
 */
async function runCandidateSuite(
  attempts: AttemptSurface,
  context: GateContext,
): Promise<{ readonly command: string; readonly exitStatus: number }> {
  const workUnitId = context.workUnitId;
  if (workUnitId === undefined) {
    return { command: "eo-gates: no work unit to measure", exitStatus: 1 };
  }
  const worktreePath = attempts.worktreePathFor(workUnitId);
  if (worktreePath === undefined) {
    return { command: `eo-gates: no retained worktree for "${workUnitId}"`, exitStatus: 1 };
  }
  const granted = attempts.grantedCommandsFor(context.changeSetId);
  if (granted === undefined) {
    return { command: "eo-gates: no envelope resolved for this change set", exitStatus: 1 };
  }
  /**
   * ⚠️ THE PRODUCER'S OWN RUNNER, not a second one, and not `captureTddBaseline`.
   *
   * `runGrantedAcceptanceCommand` is the single execution path both halves of
   * the protocol use, so "the suite passed" has one definition. Calling
   * `captureTddBaseline` here instead was tried and was WRONG: it short-circuits
   * on an empty `requirementIds`, so the candidate was never run at all and
   * every candidate reported as failing. Measured against
   * `../daemon/composed-daemon-seal-enforcement.test.ts`'s control row, which
   * could not publish.
   *
   * A capture is also not wanted here: the green half is journaled by the gate's
   * own `EvidenceRecord`, and a second record would be a duplicate claim about
   * one execution.
   */
  const run = await runGrantedAcceptanceCommand({ grantedCommands: granted, worktreePath });
  if (!run.ran) {
    return { command: run.command ?? "eo-gates: candidate suite", exitStatus: 1 };
  }
  return { command: run.command, exitStatus: run.exitStatus };
}

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
  /**
   * Phase 21's security fixtures, as BLOCKING entries — `blocking: true` on
   * every manifest entry, and `allGatesPassed` in
   * `./post-completion-pipeline.ts` treats a `false` verdict from any tag as a
   * refusal to publish. Registered with no arguments deliberately: the manifest
   * owns its own entries and each `verify` closes over the real, shipped
   * primitives, so there is no seam here for a caller to substitute a passing
   * fixture through. That is the same rule the file header states for the
   * registry itself.
   *
   * COUNT, corrected 2026-08-07 at the v1.6.0 cut: this comment said "six"
   * until now and the manifest carries SEVEN. #122's Jira tenant-boundary
   * fixture joined through `REQUIRED_SECURITY_FIXTURE_IDS` with no edit at
   * this call site — which is the no-arguments registration working as
   * designed, and also exactly why a hand-written count here goes stale
   * without anything failing. Do not write the number here again; read it
   * from the manifest.
   */
  registerSecurityFixtureManifest(registry);
  /**
   * The TDD gate — owner decision 2026-08-18, and the registration
   * `createTddGate` could never have (its per-attempt constructor arguments do
   * not exist at startup; `@crabgic/gates`' `tdd-gate-registration.ts`).
   *
   * Registered `perWorkUnit`, so `fireAll` skips it: it judges ONE attempt
   * against ONE dispatch boundary, and a `final_verifying` context carries no
   * `workUnitId` by design. `./post-completion-pipeline.ts` fires it by tag,
   * once per collected candidate, at `verifying`.
   */
  registerTddGate(registry, {
    requirementIds: (context): readonly string[] =>
      context.workUnitId === undefined
        ? []
        : workUnitRequirementIds(deps.workUnits, context.workUnitId),
    runCandidate: (context) => runCandidateSuite(deps.attempts, context),
  });
  /**
   * Owner ruling R5's publish refusal, registered under the SAME `acceptance`
   * tag and reading the SAME requirement union the seal gate does — so the two
   * can never disagree about what this run's bar is, which is the property the
   * union resolver above exists for.
   *
   * It clears this file's admission test on the same grounds the seal gate does:
   * a journal read and a set difference. No subprocess, no measurement, no
   * capability store, no engine.
   *
   * ⚠️ THIS ONE CHANGES WHAT THE PRODUCT PROMISES, and unlike every other
   * registration here it will refuse runs that used to publish. Before it, the
   * terminal state `published_local` meant "a worker claimed success and its
   * diff merged cleanly"; after it, the claim carries a check. Both runs in
   * `docs/evidence/phase-25/published-unverified.md` become refused runs, which
   * is the owner's stated intent rather than a regression — the cost was put to
   * them with the ruling and accepted with it.
   */
  registerAcceptanceEvaluatedGate(registry, {
    requirements: (context): readonly Requirement[] =>
      resolveRequirementsStrict(
        deps.requirements,
        changeSetRequirementIds(deps.workUnits, context.changeSetId),
        context.changeSetId,
      ),
  });
  return registry;
}

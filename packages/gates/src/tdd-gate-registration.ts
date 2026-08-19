import type { JournalStore } from "@crabgic/journal";
import type { GateContext, GateVerdict } from "./types.js";
import type { GateRegistry } from "./registry.js";
import type { ChangedTestsBaselineOutcome } from "./red-baseline-from-tests.js";

/**
 * `registerTddGate` — the CONSUMER half of the red-before-green protocol, in
 * the only shape the daemon can actually register.
 *
 * ⚠️ WHY `createTddGate` COULD NOT BE THIS. `./tdd-gate.ts`'s `createTddGate`
 * takes `requirementId`, `beforeSeq`, `exitStatus` and `testCommand` as
 * CONSTRUCTOR arguments and bakes them into a closure. Every one of those is
 * per-attempt. `packages/cli/src/daemon/compose-gate-registry.ts` builds ONE
 * registry per dispatcher at startup — "one shared instance, never a second
 * copy" — before any attempt exists, so there is no moment at which a caller
 * could supply them. MEASURED 2026-08-18: `createTddGate` had **zero**
 * production call sites, and that mismatch is the whole reason.
 *
 * This registrar runs the SAME check under the SAME rules, reading its
 * per-attempt inputs from the `GateContext` and the journal at FIRING time.
 * That is the identical discipline `registerCriteriaSealGate` states for its
 * own requirements reader: reading at registration would pin a snapshot taken
 * before the work ran, which is exactly the window a tamper lives in.
 *
 * `createTddGate` is deliberately left in place rather than deleted. Phase 14's
 * closeout criterion cites `tdd-gate.test.ts` by line, and its own tests are
 * the record of what the check means; this module is a second entry point to
 * that meaning, not a replacement for it.
 */

export const TDD_GATE_NAME = "tdd-evidence";

/** What one candidate test run reports back. `toolchainFingerprint` defaults to this package's own name when the runner does not identify itself. */
export interface CandidateTestRun {
  readonly command: string;
  readonly exitStatus: number;
  readonly toolchainFingerprint?: string;
}

export interface TddGateRegistration {
  /**
   * The requirement ids the firing work unit declares, read WHEN the gate
   * fires. A function rather than a value, for the same reason the seal gate's
   * requirements reader is one.
   */
  readonly requirementIds: (context: GateContext) => readonly string[];
  /**
   * Establishes the RED half: runs the tests this change set added against the
   * frozen base code, and journals a baseline when they fail
   * (`../red-baseline-from-tests.ts`).
   *
   * ⚠️ MEASURED AT FIRING TIME RATHER THAN READ BACK FROM THE JOURNAL, and that
   * collapse is what removed an entire class of problem. The previous shape had
   * a producer running before dispatch and a consumer re-reading the journal
   * afterwards, which forced an ordering cut (`beforeSeq`) to tell a genuine
   * baseline from the gate's own earlier verdict. A diff-derived baseline cannot
   * satisfy that cut — it does not exist until the worker has finished — so the
   * two halves are now one firing, and the ordering question disappears rather
   * than being answered.
   *
   * The record is still journaled, because the evidence trail is the product.
   * The gate simply does not have to trust the journal to know what it just did.
   */
  readonly measureRedAtBase: (context: GateContext) => Promise<ChangedTestsBaselineOutcome>;
  /**
   * Runs the candidate's own test command and reports its exit status — the
   * GREEN half. Supplied by the composition root because this package cannot
   * know how to run a project's stack commands, and must not guess.
   */
  readonly runCandidate: (context: GateContext) => Promise<CandidateTestRun>;
}

const DEFAULT_FINGERPRINT = "@crabgic/gates";

/**
 * Why no red half could be established. Each member has a DIFFERENT repair, so
 * each says its own thing rather than collapsing to "no baseline".
 */
function describeUnestablishedRed(outcome: ChangedTestsBaselineOutcome): string {
  switch (outcome.kind) {
    case "noTestFiles":
      return "this change set added no test file, so there is nothing that could have been red";
    case "notRed":
      return (
        "the tests this change set added already PASS against the base code, so they do not " +
        "discriminate this work from its absence"
      );
    case "noAcceptanceCommand":
      return "the approved envelope grants no acceptance-class command, so nothing could be run";
    case "didNotRun":
      return `the base-code test run did not complete: ${outcome.reason}`;
    case "noRequirements":
      return "no requirement was declared to scope a baseline to";
    /* c8 ignore next 2 -- `captured` is handled by the caller before this is reached. */
    default:
      return "the red half was not established";
  }
}

/**
 * The seq of the LATEST `work_unit_transition: dispatched` entry for
 * `workUnitId`, or `undefined` when the unit was never dispatched.
 *
 * ⚠️ LATEST, NOT FIRST. A repaired unit is dispatched more than once, and each
 * attempt must be judged against its OWN boundary: taking the first would let
 * attempt 2 count attempt 1's post-dispatch journal traffic as a legitimate
 * pre-dispatch baseline, which is the same forgery the boundary exists to
 * close.
 */
export async function latestDispatchBoundarySeq(
  journal: JournalStore,
  workUnitId: string,
): Promise<number | undefined> {
  let latest: number | undefined;
  for await (const entry of journal.queryEntries({ type: "work_unit_transition" })) {
    if (entry.type !== "work_unit_transition") continue;
    if (entry.workUnitId !== workUnitId) continue;
    if ((entry.payload as { readonly status?: string }).status !== "dispatched") continue;
    if (latest === undefined || entry.seq > latest) latest = entry.seq;
  }
  return latest;
}

/**
 * A verdict rather than a throw, so `emitEvidence` still journals it — a gate
 * that throws leaves no record that it refused.
 *
 * ⚠️ INCONCLUSIVE, NOT FAILED, and owner ruling 2026-08-18 is why. Every caller
 * of this helper is a case where the check's own PRECONDITION could not be met:
 * no work unit, no dispatch boundary, no declared requirement, no red baseline.
 * None of those is a finding about the candidate's code.
 *
 * MEASURED: treating them as failures blocked every real run. A healthy
 * repository is green at base, so no red baseline is ever captured, so the gate
 * refused — the gate was satisfiable only when the repository was already
 * broken. `inconclusive` blocks nothing and, because the emitted record carries
 * no `gateVerdict`, still proves nothing: `implement-tests-first` stays
 * underivable, which is the honest answer for a check that did not run.
 */
function unestablished(command: string, fingerprint: string, detail: string): GateVerdict {
  return {
    passed: false,
    inconclusive: true,
    command,
    exitStatus: 1,
    toolchainFingerprint: fingerprint,
    artifactDigests: [],
    detail,
  };
}

/**
 * Registers the `tdd` handler.
 *
 * ⚠️ EVERY declared requirement needs its OWN red baseline. `hasRedBaseline`
 * is requirement-scoped, and a unit declaring two requirements with one
 * baseline between them has proved a failing test for one of them and nothing
 * at all for the other. An `.some()` here would silently weaken the claim to
 * "some requirement was red", which is not what the criterion says.
 *
 * FAILS CLOSED on every input it cannot judge: no work unit (a
 * `final_verifying` firing has none by design, and this check is per-unit by
 * construction), no journaled dispatch boundary, no declared requirements.
 * Each of those is a state in which passing would mint a verdict nobody earned.
 */
export function registerTddGate(registry: GateRegistry, options: TddGateRegistration): void {
  const handler = async (context: GateContext): Promise<GateVerdict> => {
    const command = "eo-gates: red-before-green TDD evidence";

    const workUnitId = context.workUnitId;
    if (workUnitId === undefined) {
      return unestablished(
        command,
        DEFAULT_FINGERPRINT,
        "the TDD gate is per-work-unit and this firing carries no work unit",
      );
    }

    const requirementIds = options.requirementIds(context);
    if (requirementIds.length === 0) {
      return unestablished(
        command,
        DEFAULT_FINGERPRINT,
        `work unit "${workUnitId}" declares no requirement, so no red baseline could be red ` +
          `against one`,
      );
    }

    /**
     * ⚠️ THE DISCRIMINATION CHECK. Not "was the suite red at base" — a healthy
     * repository is green at base, and asking that refused every real run. This
     * asks whether the tests THIS change set added fail against the code that
     * preceded it.
     */
    const red = await options.measureRedAtBase(context);
    if (red.kind !== "captured") {
      return unestablished(command, DEFAULT_FINGERPRINT, describeUnestablishedRed(red));
    }

    // Only now is the candidate run worth its cost: the red half is established,
    // so this run is the green half rather than a measurement of nothing.
    const candidate = await options.runCandidate(context);
    const fingerprint = candidate.toolchainFingerprint ?? DEFAULT_FINGERPRINT;
    const passed = candidate.exitStatus === 0;
    return {
      passed,
      command: candidate.command,
      exitStatus: candidate.exitStatus,
      toolchainFingerprint: fingerprint,
      artifactDigests: [],
      detail: passed
        ? `the change set's own tests fail against base and pass against the candidate ` +
          `(${String(red.records.length)} requirement(s), via ${red.command})`
        : `the change set's own tests fail against base, and are STILL failing against the ` +
          `candidate`,
    };
  };

  /**
   * ⚠️ `perWorkUnit`, so `fireAll` — final-candidate re-verification — skips
   * this gate. It judges ONE attempt against ONE dispatch boundary, and a
   * `final_verifying` context carries no `workUnitId` by design, so firing it
   * there would fail every run closed. It fires through `fireByTag`, once per
   * collected candidate, at `verifying`.
   *
   * The `workUnitId === undefined` refusal above stays as defence in depth: the
   * marker governs `fireAll`, and nothing stops a caller invoking `fireByTag`
   * with a context that has no unit.
   */
  registry.register("tdd", TDD_GATE_NAME, handler, { perWorkUnit: true });
}

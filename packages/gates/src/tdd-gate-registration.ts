import type { JournalStore } from "@crabgic/journal";
import type { GateContext, GateVerdict } from "./types.js";
import type { GateRegistry } from "./registry.js";
import { hasRedBaseline } from "./tdd-gate.js";

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
   * Runs the candidate's own test command and reports its exit status — the
   * GREEN half. Supplied by the composition root because this package cannot
   * know how to run a project's stack commands, and must not guess.
   */
  readonly runCandidate: (context: GateContext) => Promise<CandidateTestRun>;
}

const DEFAULT_FINGERPRINT = "@crabgic/gates";

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

/** A blocking verdict rather than a throw, so `emitEvidence` still journals the refusal — a gate that throws leaves no record that it refused. */
function refuse(command: string, fingerprint: string, detail: string): GateVerdict {
  return {
    passed: false,
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
  registry.register("tdd", TDD_GATE_NAME, async (context): Promise<GateVerdict> => {
    const command = "eo-gates: red-before-green TDD evidence";

    const workUnitId = context.workUnitId;
    if (workUnitId === undefined) {
      return refuse(
        command,
        DEFAULT_FINGERPRINT,
        "the TDD gate is per-work-unit and this firing carries no work unit — failing closed",
      );
    }

    const requirementIds = options.requirementIds(context);
    if (requirementIds.length === 0) {
      return refuse(
        command,
        DEFAULT_FINGERPRINT,
        `work unit "${workUnitId}" declares no requirement, so no red baseline could be red ` +
          `against one — failing closed`,
      );
    }

    const boundary = await latestDispatchBoundarySeq(context.journal, workUnitId);
    if (boundary === undefined) {
      return refuse(
        command,
        DEFAULT_FINGERPRINT,
        `no dispatch boundary is journaled for work unit "${workUnitId}", so "before dispatch" ` +
          `has no meaning here — failing closed`,
      );
    }

    const missing: string[] = [];
    for (const requirementId of requirementIds) {
      if (!(await hasRedBaseline(context.journal, requirementId, boundary))) {
        missing.push(requirementId);
      }
    }
    if (missing.length > 0) {
      return refuse(
        command,
        DEFAULT_FINGERPRINT,
        `no red-baseline EvidenceRecord precedes this attempt's dispatch for requirement(s) ` +
          `${missing.join(", ")} — failing closed`,
      );
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
        ? `red-baseline confirmed before dispatch; candidate is green for ${String(requirementIds.length)} requirement(s)`
        : `red-baseline confirmed before dispatch, but the candidate is still failing`,
    };
  });
}

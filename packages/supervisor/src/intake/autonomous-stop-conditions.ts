import { resolveStopCondition, type AutonomySettings } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";
import type { RunsRegistry } from "../registries/runs-registry.js";
import type { RunRecord } from "../router/operations.js";
import { haltOnStopCondition, type StopConditionKind } from "./stop-conditions.js";

/**
 * The autonomy-aware stop-condition path — owner ruling R3 (2026-08-15),
 * roadmap/25 work item 10.
 *
 * The owner's pipeline requires that after the design gate "no human/user
 * feedback is needed and everything must be completed automatically". Three of
 * the seven stop conditions fire after that gate, and all three halted. R3
 * granted a declared default for `irreducible_product_decision` and
 * `exhausted_repairs`, and permanently excluded `expanded_authority`.
 *
 * WHY THIS WRAPS `haltOnStopCondition` RATHER THAN CHANGING IT. That function
 * halts, correctly, for every one of the seven conditions, and its ordering
 * discipline — transition first, journal second, so a refused transition leaves
 * no stray record — was earned from an adversarial-validation finding. Threading
 * an autonomy document through it would put a "sometimes this does nothing"
 * branch inside the one function whose job is to stop a run. The halt path stays
 * exactly as it was and keeps its tests; the decision about WHETHER to halt is
 * made here, before it is called.
 *
 * THE DEFAULT IS JOURNALED ON THE SAME ENTRY KIND AS A HALT
 * (`adjudication_decision`), because `JournalEntryType` is closed at thirteen
 * members and ledger Gap 5 forbids a unilateral fourteenth. Phases 12, 14 and 24
 * each made the same choice for the same reason.
 */

export interface ApplyStopConditionOptions {
  readonly journal: JournalStore;
  readonly runs: RunsRegistry;
  readonly runId: string;
  readonly changeSetId: string;
  readonly kind: StopConditionKind;
  readonly reason: string;
  /**
   * The run's autonomy document.
   *
   * REQUIRED, not optional. An optional field defaulting to "halt" would read
   * identically to a caller that forgot to pass one, and the two are different
   * situations: one is a project that declined autonomy, the other is a wiring
   * bug. `HALTING_AUTONOMY` is the explicit way to say the first.
   */
  readonly autonomy: AutonomySettings;
}

export interface StopConditionOutcome {
  readonly halted: boolean;
  /** The run record, when the condition halted the run. */
  readonly record?: RunRecord;
  /** The declared default taken, when it did not. */
  readonly disposition?: string;
}

/**
 * Halts the run, or takes its declared default and lets the run continue.
 *
 * The defaulted branch journals BOTH halves — what was decided, and why the
 * condition fired. "We defaulted" without the trigger is unauditable, and the
 * owner reading this entry weeks later has no other source: they were not asked
 * at the time, by design.
 *
 * `declaredBefore` is stated in the rationale text rather than only carried in
 * the typed record, because a reader of the journal has to be able to tell a
 * pre-declared default from a disposition chosen while the decision was live.
 * That distinction is the whole basis on which R3 is safe.
 */
export async function applyStopCondition(
  options: ApplyStopConditionOptions,
): Promise<StopConditionOutcome> {
  const verdict = resolveStopCondition(options.kind, options.autonomy);

  if (verdict.halts) {
    const record = await haltOnStopCondition({
      journal: options.journal,
      runs: options.runs,
      runId: options.runId,
      changeSetId: options.changeSetId,
      kind: options.kind,
      reason: options.reason,
    });
    return { halted: true, record };
  }

  await options.journal.appendEntry({
    type: "adjudication_decision",
    runId: options.runId,
    changeSetId: options.changeSetId,
    payload: {
      decision: "autonomy_default_taken",
      rationale: `stop condition "${options.kind}" fired: ${options.reason} — took the default "${String(verdict.disposition)}", declared before the run rather than chosen when the condition fired`,
      subjectId: options.runId,
    },
  });

  return {
    halted: false,
    ...(verdict.disposition !== undefined ? { disposition: verdict.disposition } : {}),
  };
}

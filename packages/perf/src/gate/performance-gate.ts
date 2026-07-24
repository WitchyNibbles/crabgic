import { randomUUID } from "node:crypto";
import type {
  PerformanceMetric,
  PerformanceOutcome,
  ProvisionalPerformanceBudgetEntry,
  ProvisionalPerformanceContract,
} from "@eo/contracts";
import type { GateContext, GateHandler, GateVerdict } from "@eo/gates";
import { BudgetHashLinkMismatchError, MethodologyViolationError } from "../errors.js";
import {
  buildEnforcedPerformanceContract,
  type MeasuredBudgetValue,
} from "../contract/contract-builder.js";
import { MIN_INTERLEAVED_REPETITIONS } from "../runner/methodology.js";
import { decide, type PathSensitivity } from "../stats/decision-engine.js";
import { mean } from "../stats/mean.js";

/** One budget entry's own measurement data, ready for statistical decision. */
export interface PerformanceGateEntryInput {
  readonly budget: ProvisionalPerformanceBudgetEntry;
  readonly baseSamples: readonly number[];
  readonly candidateSamples: readonly number[];
  readonly pathSensitivity: PathSensitivity;
  /** Whether `budget.threshold` is an absolute SLO (roadmap/15 §In scope, "Decision rules": "Absolute-budget breach blocks") — `true` for budgets sourced from Requirement acceptance criteria/ecosystem research, `false` for the base-revision-measurement fallback (where the threshold IS the base's own measured value, evaluated only statistically, never as a hard absolute cap on itself). */
  readonly hasAbsoluteBudget: boolean;
}

export interface PerformanceGateMeasurements {
  readonly entries: readonly PerformanceGateEntryInput[];
  readonly baseRevisionFallbackBudgets?: readonly ProvisionalPerformanceBudgetEntry[];
  readonly artifactDigests: readonly string[];
}

export interface CreatePerformanceGateHandlerOptions {
  readonly getProvisionalContract: (changeSetId: string) => Promise<ProvisionalPerformanceContract>;
  readonly getMeasurements: (
    context: GateContext,
    provisional: ProvisionalPerformanceContract,
  ) => Promise<PerformanceGateMeasurements>;
  readonly toolchainFingerprint: string;
  readonly contractIdFactory?: () => string;
  readonly now?: () => Date;
}

/** `block` > `inconclusive_blocking` > `pass` — both blocking states fail the gate (`passed: false`); `block` (a statistically PROVEN regression, or an absolute-budget breach) is reported over `inconclusive_blocking` (an unresolved noise verdict) when both occur across different budget entries in the same firing. */
function combineOutcomes(outcomes: readonly PerformanceOutcome[]): PerformanceOutcome {
  if (outcomes.some((o) => o === "block")) return "block";
  if (outcomes.some((o) => o === "inconclusive_blocking")) return "inconclusive_blocking";
  return "pass";
}

/**
 * Defense-in-depth methodology floor — adversarial-validation MINOR-1 fix.
 * The ≥10-rep/interleave enforcement previously lived ONLY in
 * `../runner/twin-worktree-runner.ts`, but the GATE HANDLER (the surface
 * actually registered into 14, consuming pre-computed
 * `baseSamples`/`candidateSamples`) never itself checked the sample count
 * before calling `decide()` — a caller supplying, say, 5 samples per side
 * got an ordinary pass/block verdict instead of a refusal. This check
 * re-enforces the SAME `MIN_INTERLEAVED_REPETITIONS` floor the runner
 * already enforces, at the gate boundary too, so a caller that bypasses
 * (or never uses) the runner still cannot produce a verdict from an
 * under-sampled measurement set. THROWS (rejects the whole firing, no
 * verdict, no evidence) — matching `MethodologyViolationError`'s existing
 * "REFUSES to produce a verdict" semantics everywhere else in this
 * package, never converted into a recordable blocking `GateVerdict` (that
 * conversion is reserved for the hash-link check specifically — see this
 * file's own doc comment on why the two failure modes are handled
 * oppositely).
 */
function assertGateInputMeetsMethodologyFloor(entries: readonly PerformanceGateEntryInput[]): void {
  for (const entry of entries) {
    if (
      entry.baseSamples.length < MIN_INTERLEAVED_REPETITIONS ||
      entry.candidateSamples.length < MIN_INTERLEAVED_REPETITIONS
    ) {
      throw new MethodologyViolationError(
        "too_few_repetitions",
        `gate input for metric "${entry.budget.metric}" carries base=${String(entry.baseSamples.length)} ` +
          `candidate=${String(entry.candidateSamples.length)} samples; need >= ` +
          `${String(MIN_INTERLEAVED_REPETITIONS)} of each (defense-in-depth floor at the gate boundary — ` +
          "see ../runner/methodology.ts for the runner's own identical enforcement).",
      );
    }
  }
}

/**
 * The performance gate handler — roadmap/15 §Interfaces produced,
 * "Performance gate handler": "registered into 14's risk-tag-keyed gate
 * registry under the IntentContract's `performance` tag, firing at
 * `final_verifying`." Registered via `@eo/gates`' PUBLIC `createGateRegistry
 * ().register("performance", "eo-perf-twin-worktree-benchmark", handler)` —
 * this package never edits `packages/gates` (the "no new dependency edge"
 * pattern, interface-ledger Gap 1's own aggregation precedent).
 *
 * METHODOLOGY FLOOR (defense-in-depth, adversarial-validation MINOR-1):
 * `assertGateInputMeetsMethodologyFloor` runs FIRST, before any
 * `decide()` call — an under-sampled measurement set REFUSES (rejects)
 * rather than producing a verdict at all.
 *
 * FAIL-CLOSED HASH-LINK (roadmap/15 exit criterion: "Enforced budgets are
 * hash-linked to the approved envelope; a tampered post-approval edit
 * fails closed"): `BudgetHashLinkMismatchError` (and its
 * `BudgetJournalAnchorMissingError` subclass) from `../contract/
 * contract-builder.ts` is caught HERE (not left to reject the whole
 * firing) and converted into an ordinary BLOCKING `GateVerdict` — so the
 * registry's own `emitEvidence` still journals a normal `evidence_pointer`
 * entry recording the block (the roadmap's own "… integration test +
 * JOURNAL ENTRY" phrasing), rather than the firing rejecting with no
 * evidence at all. This is the opposite of how a methodology violation is
 * handled (both the runner's own and this gate's own defense-in-depth
 * floor above) — REJECTS, no verdict, no evidence — since that failure
 * mode is about the measurement never having produced trustworthy samples
 * at all, not about a verdict that should still be recorded.
 *
 * Passes `context.journal` through to `buildEnforcedPerformanceContract`
 * so its hash-link check can read back the tamper-evident, journal-
 * anchored approval-time budget commit (`../contract/hash-link.ts`'s own
 * doc comment covers the full MAJOR-fix threat model).
 */
export function createPerformanceGateHandler(
  options: CreatePerformanceGateHandlerOptions,
): GateHandler {
  return async (context: GateContext): Promise<GateVerdict> => {
    const provisional = await options.getProvisionalContract(context.changeSetId);
    const measurements = await options.getMeasurements(context, provisional);

    assertGateInputMeetsMethodologyFloor(measurements.entries);

    const decisions = measurements.entries.map((entry) =>
      decide({
        metric: entry.budget.metric,
        baseSamples: entry.baseSamples,
        candidateSamples: entry.candidateSamples,
        pathSensitivity: entry.pathSensitivity,
        ...(entry.hasAbsoluteBudget ? { absoluteBudget: entry.budget.threshold } : {}),
      }),
    );

    const overallOutcome = combineOutcomes(decisions.map((d) => d.outcome));

    const measuredValues: MeasuredBudgetValue[] = measurements.entries.map((entry) => ({
      metric: entry.budget.metric as PerformanceMetric,
      ...(entry.budget.percentile !== undefined ? { percentile: entry.budget.percentile } : {}),
      value: mean(entry.candidateSamples),
    }));

    try {
      const enforced = await buildEnforcedPerformanceContract({
        id: options.contractIdFactory?.() ?? randomUUID(),
        createdAt: (options.now?.() ?? new Date()).toISOString(),
        provisional,
        journal: context.journal,
        outcome: overallOutcome,
        measuredValues,
        ...(measurements.baseRevisionFallbackBudgets !== undefined
          ? { baseRevisionFallbackBudgets: measurements.baseRevisionFallbackBudgets }
          : {}),
      });

      return {
        passed: overallOutcome === "pass",
        command: "eo-perf: twin-worktree A/B benchmark",
        exitStatus: overallOutcome === "pass" ? 0 : 1,
        toolchainFingerprint: options.toolchainFingerprint,
        artifactDigests: measurements.artifactDigests,
        detail: JSON.stringify({
          outcome: overallOutcome,
          enforcedContractId: enforced.id,
          decisions: decisions.map((d) => d.reason),
        }),
      };
    } catch (error) {
      if (error instanceof BudgetHashLinkMismatchError) {
        return {
          passed: false,
          command: "eo-perf: twin-worktree A/B benchmark",
          exitStatus: 1,
          toolchainFingerprint: options.toolchainFingerprint,
          artifactDigests: measurements.artifactDigests,
          detail: `hash-link check failed (${error.reason}) — enforced budgets no longer verify against the approval-time journal record: ${error.message}`,
        };
      }
      throw error;
    }
  };
}

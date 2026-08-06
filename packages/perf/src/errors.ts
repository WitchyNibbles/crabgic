/**
 * Typed errors for `@crabgic/perf` — roadmap/15-performance-contracts.md's
 * fail-closed posture (mirrors `@crabgic/gates`/`@crabgic/scheduler`'s own "typed
 * errors, never silent swallow" convention): every place this package
 * refuses to proceed does so with a named, catchable error type.
 */
import type { BudgetIntegrityFailureReason } from "./contract/hash-link.js";

/**
 * Why a benchmark schedule/run was refused a verdict — roadmap/15 §In
 * scope, "Methodology": "≥10 interleaved repetitions (A/B alternating
 * base/candidate, never concurrent)"; §Critical correctness points: "a
 * benchmark methodology violation (too few reps, no interleave) REFUSES to
 * produce a verdict (typed)."
 */
export type MethodologyViolationReason =
  "too_few_repetitions" | "not_interleaved" | "concurrent_execution";

export class MethodologyViolationError extends Error {
  constructor(
    readonly reason: MethodologyViolationReason,
    detail: string,
  ) {
    super(
      `perf: benchmark methodology violation (${reason}) — refusing to produce a verdict: ${detail}`,
    );
    this.name = "MethodologyViolationError";
  }
}

/**
 * Thrown when an enforced `PerformanceContract`'s budgets cannot be
 * hash-linked to the provisional instance 11 already committed at approval
 * time — roadmap/15 §In scope, "Budget sourcing": "the enforced figure must
 * hash-match the provisional one 11's approval render already committed to
 * … a mismatch fails closed rather than silently re-sourcing." Fail-closed:
 * this is thrown, never silently swallowed into a passing verdict.
 *
 * Carries `reason` (`./contract/hash-link.ts`'s own
 * `BudgetIntegrityFailureReason`) so a caller (or a test) can distinguish
 * the naive "hash left stale" vector (`self_consistency_mismatch`) from
 * the REAL, journal-anchored tamper-evidence catches added by the
 * adversarial-validation MAJOR fix: `no_journal_anchor` (this provisional
 * contract id was never durably committed via 04's idempotency registry
 * at all) and `journal_anchor_mismatch` (a deliberate post-approval
 * widening that ALSO recomputed its own `budgetHash` consistently no
 * longer matches what was chained into the journal at approval time).
 *
 * Widened 2026-08-06 (ledger Gap 22) with the two reasons that bind the
 * enforced budget to what a HUMAN approved rather than to what intake
 * committed: `no_envelope_budget_binding` (see
 * `EnvelopeBudgetBindingMissingError` below) and `envelope_hash_mismatch`
 * (the approved envelope's signed content covers a different budget set).
 */
export class BudgetHashLinkMismatchError extends Error {
  constructor(
    readonly reason: BudgetIntegrityFailureReason,
    detail: string,
  ) {
    super(
      `perf: enforced budget hash-link check failed (${reason}) — refusing to enforce a budget ` +
        `that cannot be verified against the tamper-evident approval-time journal record ` +
        `(fail-closed; never silently re-sourced). ${detail}`,
    );
    this.name = "BudgetHashLinkMismatchError";
  }
}

/**
 * Thrown when `./contract/journal-anchor.ts` finds no `remote_operation_
 * record` entry anywhere in the journal committing a given provisional
 * `PerformanceContract` id — re-exported alongside
 * `BudgetHashLinkMismatchError` since `./contract/contract-builder.ts`
 * folds this specific reason into that same error type (both are
 * fail-closed hash-link refusals; this class exists so a caller wanting to
 * `instanceof`-check the "no anchor at all" case specifically — as
 * distinct from "an anchor existed but disagreed" — has a precise type to
 * catch, without inspecting `BudgetHashLinkMismatchError.reason` by string).
 */
export class BudgetJournalAnchorMissingError extends BudgetHashLinkMismatchError {
  constructor(readonly provisionalPerformanceContractId: string) {
    super(
      "no_journal_anchor",
      `No approval-time journal commit was ever found for provisional PerformanceContract id ` +
        `"${provisionalPerformanceContractId}" — either this ChangeSet never went through 11's ` +
        `real approval pipeline, or its provisionalPerformanceContractId was tampered to point at ` +
        `a fabricated, never-approved record.`,
    );
    this.name = "BudgetJournalAnchorMissingError";
  }
}

/**
 * Thrown when no APPROVED envelope binding is available for the budget about
 * to be enforced — interface-ledger Gap 22 (2026-08-06). Either the caller
 * could not resolve the ChangeSet's `AuthorizationEnvelope` at all, or the one
 * it resolved carries no `provisionalBudgetHash` (an envelope persisted before
 * the binding existed).
 *
 * Fail-closed, and deliberately a DISTINCT type from the mismatch case, exactly
 * as `BudgetJournalAnchorMissingError` is distinct from its own mismatch: "no
 * one ever signed a budget for this run" and "someone signed a DIFFERENT
 * budget" are different findings, and a reader of the blocking verdict must be
 * able to tell them apart without string-matching a reason.
 *
 * Legacy note (a disclosed residual, not a defect): a ChangeSet whose envelope
 * predates this axis cannot pass enforcement. Drain in-flight runs before
 * upgrading; a fresh `requestKey` re-intake mints a bound envelope.
 */
export class EnvelopeBudgetBindingMissingError extends BudgetHashLinkMismatchError {
  constructor(readonly provisionalPerformanceContractId: string) {
    super(
      "no_envelope_budget_binding",
      `No approved AuthorizationEnvelope binding was resolvable for provisional ` +
        `PerformanceContract id "${provisionalPerformanceContractId}" — either no envelope was ` +
        `resolved for this ChangeSet, or the resolved envelope carries no provisionalBudgetHash ` +
        `(it predates the binding). Refusing to enforce a budget no approval token ever signed.`,
    );
    this.name = "EnvelopeBudgetBindingMissingError";
  }
}

/** Thrown by `./measurement/process-sampler.ts` when a requested pid has no readable `/proc/<pid>/*` entries (process already exited, or `/proc` unavailable on this platform). */
export class ProcessSampleUnavailableError extends Error {
  constructor(readonly pid: number) {
    super(
      `perf: no /proc sample available for pid ${String(pid)} (process exited or /proc unsupported)`,
    );
    this.name = "ProcessSampleUnavailableError";
  }
}

/** Thrown when a benchmark command adapter has no ecosystem-declared `benchmarkCommand` to run. */
export class NoBenchmarkCommandError extends Error {
  constructor(readonly ecosystem: string) {
    super(`perf: ecosystem "${ecosystem}" declares no ProjectProfile benchmarkCommand to run`);
    this.name = "NoBenchmarkCommandError";
  }
}

/** Thrown when the stats module is asked to bootstrap a noise bound from fewer than 2 samples. */
export class InsufficientSamplesError extends Error {
  constructor(
    readonly kind: "base" | "candidate",
    readonly count: number,
  ) {
    super(
      `perf: at least 2 ${kind} samples are required to compute a bootstrap noise bound, got ${String(count)}`,
    );
    this.name = "InsufficientSamplesError";
  }
}

/** Thrown when `./contract/contract-builder.ts` has a provisional budget entry with no corresponding measured value supplied at gate time. */
export class MissingMeasurementError extends Error {
  constructor(
    readonly metric: string,
    readonly percentile?: number,
  ) {
    super(
      `perf: no measured value supplied for budget entry metric "${metric}"` +
        (percentile !== undefined ? ` (p${String(percentile)})` : "") +
        " — refusing to build an enforced PerformanceContract with a missing measurement",
    );
    this.name = "MissingMeasurementError";
  }
}

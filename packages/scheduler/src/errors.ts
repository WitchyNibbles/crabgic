/**
 * Typed errors — roadmap/13-scheduler-packets-context.md. Every refusal
 * this package's executor/packet-builder/router can produce is a distinct,
 * named `Error` subclass (never a generic `Error`/string throw), matching
 * the repo-wide "typed errors, never silent swallow" convention (see
 * sibling packages' own error modules, e.g. `packages/engine-claude/src/
 * adapter.ts`'s `TaskPacketValidationError`).
 */

/**
 * A single `TaskPacket` field that exceeded its configured byte budget
 * (`../budgets.ts`). `diff` is an actionable, human-readable description of
 * the overage — never a silent truncation (roadmap/13 §Test plan: "a field
 * exceeding budget blocks dispatch with a diff, never silent truncation").
 */
export interface PacketBudgetViolation {
  readonly field: string;
  readonly limitBytes: number;
  readonly actualBytes: number;
  readonly overageBytes: number;
  /** Actionable diff: the exact excess tail past the budget limit. */
  readonly diff: string;
}

/**
 * Thrown by `assertPacketWithinBudget` (`../budgets.ts`) when one or more
 * `TaskPacket` fields exceed their configured size budget — dispatch is
 * BLOCKED, never silently truncated.
 */
export class PacketBudgetExceededError extends Error {
  constructor(readonly violations: readonly PacketBudgetViolation[]) {
    super(
      `TaskPacket exceeds its size budget on ${String(violations.length)} field(s): ` +
        violations
          .map(
            (v) =>
              `${v.field} (${String(v.actualBytes)} > ${String(v.limitBytes)} bytes, ` +
              `over by ${String(v.overageBytes)}: "${v.diff}")`,
          )
          .join("; "),
    );
    this.name = "PacketBudgetExceededError";
  }
}

/**
 * Thrown when a `TaskPacket` under construction would carry an owned path
 * (or an authorized-command reference — see `../task-packet-builder.ts`'s
 * doc comment for why `TaskPacket` itself has no dedicated `commands`
 * field) NOT present in the approved `AuthorizationEnvelope` it derives
 * from — the packet-⊆-envelope invariant (roadmap/13 §Test plan, Security:
 * "a TaskPacket's owned-paths/commands can never be constructed wider than
 * the approved AuthorizationEnvelope it derives from").
 */
export class PacketEnvelopeViolationError extends Error {
  constructor(
    readonly kind: "ownedPaths" | "commands",
    readonly offending: readonly string[],
  ) {
    super(
      `TaskPacket ${kind} would be constructed WIDER than its approved AuthorizationEnvelope — ` +
        `offending ${kind}: ${offending.join(", ")}`,
    );
    this.name = "PacketEnvelopeViolationError";
  }
}

/** Why a repair attempt was refused — see `RepairEvidenceRequiredError`. */
export type RepairRefusalReason = "noNewEvidence" | "attemptsExhausted" | "evidenceNotDistinct";

function repairRefusalMessage(
  workUnitId: string,
  reason: RepairRefusalReason,
  priorDispatchCount: number,
): string {
  switch (reason) {
    case "noNewEvidence":
      return (
        `work unit ${workUnitId}: repair attempt refused — no new diagnostic evidence since the ` +
        `prior dispatch (attempt ${String(priorDispatchCount + 1)} would repeat an unsuccessful ` +
        "action with nothing new to justify it)"
      );
    case "attemptsExhausted":
      return (
        `work unit ${workUnitId}: repair attempt refused — the one-initial-plus-two-repairs cap ` +
        `is already exhausted (${String(priorDispatchCount)} prior dispatches recorded)`
      );
    case "evidenceNotDistinct":
      return (
        `work unit ${workUnitId}: repair attempt refused — the cited evidence is IDENTICAL to the ` +
        "evidence that justified the immediately-prior repair (same kind, same diagnostic detail) " +
        "— repeating an unsuccessful action requires GENUINELY new evidence, not a re-citation of " +
        "the same evidence"
      );
  }
}

/**
 * Thrown by `../attempt-policy.ts` when a repair attempt is requested
 * without qualifying "new diagnostic evidence" (`noNewEvidence`), when the
 * one-initial-plus-two-evidence-driven-repairs cap has already been
 * reached even though evidence IS present this time (`attemptsExhausted`),
 * or when the cited evidence is identical to the evidence that justified
 * the immediately-prior repair (`evidenceNotDistinct`) — roadmap/13 §In
 * scope, "Attempt policy": "repeating an unsuccessful action requires new
 * diagnostic evidence... a third attempt WITHOUT new diagnostic evidence
 * is refused with a TYPED error."
 */
export class RepairEvidenceRequiredError extends Error {
  constructor(
    readonly workUnitId: string,
    readonly reason: RepairRefusalReason,
    readonly priorDispatchCount: number,
  ) {
    super(repairRefusalMessage(workUnitId, reason, priorDispatchCount));
    this.name = "RepairEvidenceRequiredError";
  }
}

/**
 * Thrown when a dispatch/resume is attempted while an account-wide
 * (global) rate-limit pause is active (roadmap/13 §In scope, "Limit
 * parking": "account-wide signals pause globally") — see
 * `../parking.ts`'s `assertNotGloballyPaused`, consulted by
 * `../executor.ts` immediately before every `spawn`/`resume`.
 */
export class GlobalPauseActiveError extends Error {
  constructor(readonly resetsAt: number) {
    super(
      "scheduler: dispatch blocked — an account-wide rate-limit pause is active until epoch-" +
        `seconds ${String(resetsAt)} (roadmap/13: "account-wide signals pause globally")`,
    );
    this.name = "GlobalPauseActiveError";
  }
}

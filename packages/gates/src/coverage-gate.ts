import { recordCoverageObservation } from "./coverage/ratchet-store.js";
import type { CoverageSummary } from "./coverage/types.js";
import type { GateHandler } from "./types.js";

/** Greenfield-project minimum, per the roadmap ground rule (`roadmap/README.md`): "≥80% line+branch on all new code." */
export const GREENFIELD_COVERAGE_MINIMUM_PCT = 80;

export interface CoverageGateInput {
  /**
   * The stable project identifier the ratchet floor is scoped to (MINOR-3,
   * adversarial-validation round) — `./coverage/ratchet-store.ts` never
   * shares a floor across two different `projectId`s, even on the same
   * journal. Use `ProjectProfile.id` (`@eo/contracts`) when a resolved
   * `ProjectProfile` is available; any other stable, caller-supplied
   * identifier is otherwise accepted (this gate has no dependency on
   * `ProjectProfile` itself — see the phase-14 evidence doc's deviations).
   */
  readonly projectId: string;
  readonly summary: CoverageSummary;
}

/**
 * The registered `coverage` gate handler — roadmap/14 §In scope,
 * "Coverage" bullet: "≥80% line+branch on greenfield projects; existing
 * projects never regress below their recorded floor ... ratchet state
 * journaled and monotonic." Records the observation against
 * `./coverage/ratchet-store.ts` (journal-derived, so the floor survives a
 * restart) and fails when the observation drops below the EFFECTIVE floor.
 *
 * MINOR-2 fix (adversarial-validation round): the effective enforcement
 * floor is `max(rawRatchetFloor, GREENFIELD_COVERAGE_MINIMUM_PCT)` on BOTH
 * axes, computed EVERY firing — not merely "apply 80% only when no floor
 * has ever been recorded yet." The prior code applied the absolute 80%
 * check ONLY when `floorBefore === undefined`, but
 * `recordCoverageObservation` records the observation UNCONDITIONALLY
 * (even a failing one) — so after a single failing greenfield run (e.g.
 * 50%), the raw floor became 50, the `floorBefore === undefined` branch
 * never fired again, and a project could pass indefinitely anywhere in the
 * 50–79% band (never a regression relative to its own newly-lowered raw
 * floor, and never re-checked against 80%). Clamping the effective floor to
 * NEVER drop below 80 closes this: a project must reach ≥80% on both axes
 * at least once before the ratchet's own ordinary "never regress below the
 * recorded floor" behavior takes over unassisted (at which point the raw
 * floor is itself already ≥80, so the clamp becomes a no-op).
 *
 * CARRY-FORWARD: this gate enforces AGGREGATE line/branch coverage only.
 * The roadmap's own "changed instrumentable code reaches 80%" (diff/
 * changed-line coverage) is explicitly UNIMPLEMENTED here — no adapter or
 * gate in this package computes a per-diff coverage delta; see
 * docs/evidence/phase-14/README.md's carry-forwards section.
 */
export function createCoverageGate(input: CoverageGateInput): GateHandler {
  return async (context) => {
    const { floorBefore, regressed } = await recordCoverageObservation(
      context.journal,
      input.projectId,
      input.summary,
      context.now,
    );

    const effectiveMinLinePct = Math.max(
      floorBefore?.linePct ?? 0,
      GREENFIELD_COVERAGE_MINIMUM_PCT,
    );
    const effectiveMinBranchPct = Math.max(
      floorBefore?.branchPct ?? 0,
      GREENFIELD_COVERAGE_MINIMUM_PCT,
    );
    const belowEffectiveFloor =
      input.summary.linePct < effectiveMinLinePct ||
      input.summary.branchPct < effectiveMinBranchPct;

    const passed = !belowEffectiveFloor;
    const detail = passed
      ? `coverage OK (line ${input.summary.linePct.toFixed(2)}%, branch ${input.summary.branchPct.toFixed(2)}%)`
      : regressed
        ? `coverage regressed below the recorded floor (line ${input.summary.linePct.toFixed(2)}%, ` +
          `branch ${input.summary.branchPct.toFixed(2)}%, prior floor line ${String(floorBefore?.linePct)}%, ` +
          `branch ${String(floorBefore?.branchPct)}%)`
        : `below the effective ${String(GREENFIELD_COVERAGE_MINIMUM_PCT)}% floor (line ` +
          `${input.summary.linePct.toFixed(2)}% < ${effectiveMinLinePct.toFixed(2)}%, branch ` +
          `${input.summary.branchPct.toFixed(2)}% < ${effectiveMinBranchPct.toFixed(2)}%) — greenfield ` +
          `minimum never yet met`;

    return {
      passed,
      command: `coverage:${input.summary.toolchain}`,
      exitStatus: passed ? 0 : 1,
      toolchainFingerprint: input.summary.toolchain,
      artifactDigests: [],
      detail,
    };
  };
}

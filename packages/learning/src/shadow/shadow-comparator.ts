import {
  runShadowAttempt,
  type RunShadowAttemptOptions,
  type ShadowRunResult,
} from "@eo/scheduler";

export type ShadowComparisonVerdict = "improved" | "regressed" | "unchanged";

export interface BaselineOutcome {
  /** Whether the PRIMARY (unmodified, no lesson-preamble) attempt succeeded. */
  readonly passed: boolean;
  readonly summary?: string;
}

export interface ShadowComparison {
  readonly verdict: ShadowComparisonVerdict;
  readonly detail: string;
}

/**
 * `runShadowComparison` — roadmap/22-learning-system.md work item 4:
 * "Shadow-run comparator registered against 13's mirrored-dispatch
 * primitive; outcome diffing." This module NEVER reimplements isolated
 * dispatch itself (13's `runShadowAttempt` already owns "worktree/session,
 * cache-bypassed, marker-only journal footprint" — see
 * `@eo/scheduler/src/shadow-run.ts`'s own file-level doc comment); it is a
 * thin comparator layered on top, matching 13's own framing: "This phase
 * owns isolated execution only; comparison and grading logic belong to
 * 22."
 */
export async function runShadowComparison(
  options: RunShadowAttemptOptions,
  baseline: BaselineOutcome,
): Promise<{ readonly shadow: ShadowRunResult; readonly comparison: ShadowComparison }> {
  const shadow = await runShadowAttempt(options);
  return { shadow, comparison: compareShadowOutcome(baseline, shadow) };
}

/** Pure diffing logic — never mutates `baseline`/`shadow`, never performs I/O of its own. Exported separately so a caller that already has both outcomes (e.g. `../red-team` fixtures) can compare without re-dispatching. */
export function compareShadowOutcome(
  baseline: BaselineOutcome,
  shadow: ShadowRunResult,
): ShadowComparison {
  const shadowPassed = shadow.validation.kind === "valid";

  if (!baseline.passed && shadowPassed) {
    return {
      verdict: "improved",
      detail: "baseline attempt failed; shadow attempt (with candidate lesson) succeeded",
    };
  }
  if (baseline.passed && !shadowPassed) {
    return {
      verdict: "regressed",
      detail: `baseline attempt succeeded; shadow attempt regressed (${shadow.validation.kind})`,
    };
  }
  return {
    verdict: "unchanged",
    detail: `baseline and shadow outcomes agree (both ${baseline.passed ? "passed" : "failed"})`,
  };
}

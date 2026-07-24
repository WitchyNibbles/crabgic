import type { PerformanceMetric, PerformanceOutcome } from "@eo/contracts";
import {
  computeNoiseBoundPct,
  computeRegressionPct,
  type BootstrapNoiseBoundOptions,
} from "./bootstrap-ci.js";
import { higherIsWorse } from "./metric-direction.js";
import { mean } from "./mean.js";

/**
 * "Critical-path" vs "sensitive-path" — roadmap/15 §In scope, "Decision
 * rules": "5% for critical-path / 10% for sensitive-path changes" and
 * "Critical-path noise >15% = inconclusive and blocking." No source
 * material pins which risk categories count as "critical" vs merely
 * "sensitive" — this phase's own documented, minimal-sufficient reading:
 * a change touching the `user_visible_hot_path` risk category (`../risk/
 * categories.ts`) is "critical-path"; every other risk-tagged change is
 * "sensitive-path." Callers may also pass this explicitly (e.g. a project
 * that wants to mark its own additional paths critical) — this mapping is
 * only the DEFAULT a caller uses when deriving `PathSensitivity` from
 * detected risk categories, not baked into `decide()` itself.
 */
export type PathSensitivity = "critical" | "sensitive";

export const CRITICAL_PATH_REGRESSION_THRESHOLD_PCT = 5;
export const SENSITIVE_PATH_REGRESSION_THRESHOLD_PCT = 10;
export const CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT = 15;

export interface DecideOptions {
  readonly metric: PerformanceMetric;
  readonly baseSamples: readonly number[];
  readonly candidateSamples: readonly number[];
  readonly pathSensitivity: PathSensitivity;
  /** An absolute SLO threshold, when one exists — roadmap/15 §In scope, "Decision rules": "Absolute-budget breach blocks," checked BEFORE any statistical reasoning, unconditionally. */
  readonly absoluteBudget?: number;
  readonly noiseBoundOptions?: BootstrapNoiseBoundOptions;
  /**
   * Test-only escape hatch: bypasses the bootstrap entirely and uses this
   * EXACT noise-bound percentage instead. Bootstrap resampling cannot be
   * hand-tuned to land on an exact value like `15.0` analytically, so this
   * is how `decision-engine.test.ts` proves the ">15%" critical-path
   * inconclusive-blocking rule's boundary EXACTLY (15.0 itself does not
   * trigger it; 15.000001 does) without depending on the bootstrap's own
   * numeric output landing on a hand-picked value. Production callers
   * should never pass this — it exists solely for deterministic boundary
   * testing of `decide()`'s own comparison logic.
   */
  readonly noiseBoundPctOverride?: number;
}

export interface DecisionResult {
  readonly outcome: PerformanceOutcome;
  readonly regressionPct: number;
  readonly noiseBoundPct: number;
  readonly thresholdPct: number;
  readonly reason: string;
}

/**
 * The performance-verdict decision engine — roadmap/15 §In scope, "Decision
 * rules":
 *   - "Absolute-budget breach blocks." (checked first, unconditionally)
 *   - "Without an absolute SLO: block statistically supported regressions
 *     beyond max(noise bound, 5% for critical-path / 10% for
 *     sensitive-path changes)." — "beyond" is interpreted as STRICTLY
 *     GREATER THAN (a regression exactly AT the threshold passes; boundary
 *     tests at exactly 5%/10% assert this).
 *   - "Critical-path noise >15% = inconclusive AND blocking." — also
 *     STRICTLY greater than; exactly 15% noise on a critical path falls
 *     through to the ordinary max(noiseBound, 5%) block-threshold check
 *     instead (whose threshold is then 15%, since noise dominates).
 *
 * DETERMINISM / ORDER-INDEPENDENCE: `computeNoiseBoundPct` sorts its input
 * and uses a fixed-seed deterministic RNG (`./bootstrap-ci.ts`'s own doc
 * comment) — `decide()` inherits both properties by construction: calling
 * it twice with the SAME (possibly differently-ORDERED) sample arrays
 * always produces a byte-identical `DecisionResult`.
 */
export function decide(options: DecideOptions): DecisionResult {
  const direction = higherIsWorse(options.metric);
  const regressionPct = computeRegressionPct(
    options.baseSamples,
    options.candidateSamples,
    direction,
  );

  if (options.absoluteBudget !== undefined) {
    const candidateMean = mean(options.candidateSamples);
    const breached = direction
      ? candidateMean > options.absoluteBudget
      : candidateMean < options.absoluteBudget;
    if (breached) {
      const noiseBoundPct =
        options.noiseBoundPctOverride ??
        computeNoiseBoundPct(options.baseSamples, options.noiseBoundOptions);
      return {
        outcome: "block",
        regressionPct,
        noiseBoundPct,
        thresholdPct: 0,
        reason: `absolute budget breached: candidate mean ${String(candidateMean)} vs budget ${String(options.absoluteBudget)}`,
      };
    }
  }

  const noiseBoundPct =
    options.noiseBoundPctOverride ??
    computeNoiseBoundPct(options.baseSamples, options.noiseBoundOptions);

  if (
    options.pathSensitivity === "critical" &&
    noiseBoundPct > CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT
  ) {
    return {
      outcome: "inconclusive_blocking",
      regressionPct,
      noiseBoundPct,
      thresholdPct: CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT,
      reason:
        `critical-path noise bound ${String(noiseBoundPct)}% exceeds ` +
        `${String(CRITICAL_PATH_INCONCLUSIVE_NOISE_THRESHOLD_PCT)}% — inconclusive AND blocking, ` +
        "never routed through flake-quarantine; re-invoke on a quieter host",
    };
  }

  const baseThresholdPct =
    options.pathSensitivity === "critical"
      ? CRITICAL_PATH_REGRESSION_THRESHOLD_PCT
      : SENSITIVE_PATH_REGRESSION_THRESHOLD_PCT;
  const thresholdPct = Math.max(noiseBoundPct, baseThresholdPct);

  if (regressionPct > thresholdPct) {
    return {
      outcome: "block",
      regressionPct,
      noiseBoundPct,
      thresholdPct,
      reason: `regression ${String(regressionPct)}% exceeds max(noise ${String(noiseBoundPct)}%, ${String(baseThresholdPct)}%) = ${String(thresholdPct)}%`,
    };
  }

  return {
    outcome: "pass",
    regressionPct,
    noiseBoundPct,
    thresholdPct,
    reason: `regression ${String(regressionPct)}% within max(noise ${String(noiseBoundPct)}%, ${String(baseThresholdPct)}%) = ${String(thresholdPct)}%`,
  };
}

import { parseChangedLines } from "./coverage/changed-lines.js";
import {
  CHANGED_LINE_COVERAGE_MINIMUM_PCT,
  scoreChangedLineCoverage,
} from "./coverage/changed-line-coverage.js";
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
   * journal. Use `ProjectProfile.id` (`@crabgic/contracts`) when a resolved
   * `ProjectProfile` is available; any other stable, caller-supplied
   * identifier is otherwise accepted (this gate has no dependency on
   * `ProjectProfile` itself — see the phase-14 evidence doc's deviations).
   */
  readonly projectId: string;
  readonly summary: CoverageSummary;
  /**
   * The change set's own unified diff — owner ruling R6's input, and what turns
   * this gate from a question about the repository into a question about the
   * change.
   *
   * OPTIONAL, and its absence is honest rather than permissive: with no diff
   * there is no changed-line check to run, and the gate reports exactly the two
   * checks it has always run. What it must never do is pretend a third check
   * passed. A caller that HAS a diff and wants the third check supplies it; the
   * gate's `detail` always says which checks actually ran.
   *
   * Supplied as raw diff TEXT rather than a pre-parsed line set for the same
   * reason `AttemptCriteriaSeal` carries data and not a callback: a parsed
   * `ChangedLines` from a caller is a claim about what changed, and a caller
   * that wanted to pass could hand over an empty one. The diff is the artifact
   * git produced.
   */
  readonly diffText?: string;
  /**
   * Path prefixes this project's coverage configuration leaves OUT of the
   * denominator, so a file genuinely absent from every report it produces does
   * not read as an untested new file.
   *
   * Empty by default, which is the fail-CLOSED direction: with nothing declared,
   * an absent source file refuses. See
   * `coverage/changed-line-coverage.ts`'s `isExcludedFromCoverage` for why this
   * is required for correctness rather than a convenience — crabgic's own
   * `scripts/` directory is the motivating case.
   */
  readonly excludedFromCoverage?: readonly string[];
}

/**
 * R6's check, and the four outcomes it distinguishes. Each is a distinct thing
 * to say to an operator, and collapsing any two of them would be the failure
 * this check exists to prevent.
 */
function evaluateChangedLines(input: CoverageGateInput): {
  readonly passed: boolean;
  readonly detail: string;
} {
  if (input.diffText === undefined) {
    // NOT a pass — a check that was never asked. Said in those words, so an
    // `EvidenceRecord` cannot be read later as though the third check held.
    return { passed: true, detail: "changed-line coverage not evaluated (no diff supplied)" };
  }

  const changed = parseChangedLines(input.diffText);
  const outcome = scoreChangedLineCoverage(
    changed,
    input.summary.lines,
    input.excludedFromCoverage ?? [],
  );

  if (outcome.kind === "no-line-data") {
    /**
     * ⚠️ REFUSES. A diff was supplied, so the third check WAS asked, and the
     * report format cannot answer it. Passing here would mean any project on an
     * aggregate-only report — istanbul's `coverage-summary.json`, coverage.py's
     * `totals` — silently exempts itself from the ruling by choosing a reporter.
     */
    return {
      passed: false,
      detail:
        `changed-line coverage cannot be computed: the "${input.summary.toolchain}" report ` +
        `carries no per-line data. Use a reporter that does (lcov, or a Go cover profile).`,
    };
  }

  const { score } = outcome;

  if (score.filesAbsentFromReport.length > 0) {
    /**
     * ⚠️ REFUSES, and this is the branch that stops the whole check being
     * vacuous. A new source file no test imports is simply ABSENT from a v8 or
     * istanbul report, so every one of its lines would read "not instrumentable"
     * and it would score a perfect 100% for having no tests at all.
     */
    return {
      passed: false,
      detail:
        `changed-line coverage: ${String(score.filesAbsentFromReport.length)} changed source ` +
        `file(s) do not appear in the coverage report at all, so nothing measured them — ` +
        `${score.filesAbsentFromReport.join(", ")}. A file no test imports is absent rather ` +
        `than reported at 0%.`,
    };
  }

  if (score.pct === undefined) {
    // Benign: the diff added lines, and none of them are instrumentable —
    // comments, blanks, type-only declarations. Reported with its counts rather
    // than as a bare pass, because "nothing to measure" and "measured fine" are
    // different claims.
    return {
      passed: true,
      detail:
        `changed-line coverage: no instrumentable lines changed ` +
        `(${String(score.notInstrumentable)} changed line(s), none instrumented)`,
    };
  }

  if (score.pct >= CHANGED_LINE_COVERAGE_MINIMUM_PCT) {
    return {
      passed: true,
      detail:
        `changed-line coverage ${score.pct.toFixed(2)}% ` +
        `(${String(score.covered)}/${String(score.instrumentable)} changed instrumentable lines)`,
    };
  }

  /** The actionable refusal: which lines, in which files, the change set left unexercised. */
  const worst = [...score.uncoveredByFile]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_REPORTED_FILES)
    .map(([path, lines]) => `${path}:${summarizeLines(lines)}`)
    .join("; ");
  const omitted = score.uncoveredByFile.size - MAX_REPORTED_FILES;
  return {
    passed: false,
    detail:
      `changed-line coverage ${score.pct.toFixed(2)}% is below the ` +
      `${String(CHANGED_LINE_COVERAGE_MINIMUM_PCT)}% floor ` +
      `(${String(score.covered)}/${String(score.instrumentable)} changed instrumentable lines). ` +
      `Uncovered: ${worst}${omitted > 0 ? ` (+${String(omitted)} more file(s))` : ""}`,
  };
}

/** Bounds an unbounded refusal — a 400-file change set must not emit a 400-entry string. */
const MAX_REPORTED_FILES = 5;
/** Bounds it again per file, for the same reason. */
const MAX_REPORTED_LINES = 10;

/** Collapses consecutive line numbers into ranges, so `1,2,3,9` reads `1-3,9`. */
function summarizeLines(lines: readonly number[]): string {
  const ranges: string[] = [];
  let start = lines[0];
  let previous = start;
  for (const line of lines.slice(1)) {
    if (line === previous! + 1) {
      previous = line;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`);
    start = line;
    previous = line;
  }
  if (start !== undefined) {
    ranges.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`);
  }
  const shown = ranges.slice(0, MAX_REPORTED_LINES).join(",");
  return ranges.length > MAX_REPORTED_LINES ? `${shown},…` : shown;
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
 * ~~CARRY-FORWARD: this gate enforces AGGREGATE line/branch coverage only.
 * The roadmap's own "changed instrumentable code reaches 80%" (diff/
 * changed-line coverage) is explicitly UNIMPLEMENTED here — no adapter or
 * gate in this package computes a per-diff coverage delta; see
 * docs/evidence/phase-14/README.md's carry-forwards section.~~
 *
 * **DISCHARGED 2026-08-16 by owner ruling R6.** Struck rather than deleted, per
 * this repository's annotate-never-rewrite convention. The third check is below,
 * and the three ingredients the evidence doc said it needed all exist now:
 * `coverage/changed-lines.ts` parses the diff into a per-file added-line set,
 * `coverage/lcov-adapter.ts` and `coverage/go-cover-adapter.ts` return the
 * per-line detail they used to discard, and
 * `coverage/changed-line-coverage.ts` scores one against the other.
 *
 * WHY R6 CHANGED THE GATE RATHER THAN THE GRANT. The cheaper option — a scoped
 * test command added to `GRANTABLE_COMMAND_PREFIXES` — was offered first and
 * declined: the emitted permission rule is a `:*` PREFIX rule, so every member
 * of that union widens more than it looks like it does, and a vocabulary widened
 * to work around a coverage threshold is a permanent grant bought to fix a
 * configuration. Full reasoning:
 * `docs/design/owner-pipeline-conformance.md` §6b.
 *
 * THE THREE CHECKS, and they are independent — a run can fail any one of them
 * while passing the other two:
 *
 *   1. the greenfield minimum, on the AGGREGATE (unchanged);
 *   2. the ratchet, on the AGGREGATE (unchanged);
 *   3. ⚠️ R6's changed-instrumentable-line floor, on THIS CHANGE SET.
 *
 * Check 3 runs only when a diff is supplied, and the verdict's `detail` names
 * which checks ran — so "the third check passed" and "the third check was not
 * asked" can never be confused by a reader of the evidence record.
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

    const changed = evaluateChangedLines(input);

    const passed = !belowEffectiveFloor && changed.passed;
    if (!changed.passed) {
      /**
       * R6's check reports FIRST when it fails, because it is the one a change
       * set's author can act on. The aggregate checks describe the repository;
       * this one describes their diff.
       */
      return {
        passed: false,
        command: `coverage:${input.summary.toolchain}`,
        exitStatus: 1,
        toolchainFingerprint: input.summary.toolchain,
        artifactDigests: [],
        detail: changed.detail,
      };
    }

    const detail = passed
      ? `coverage OK (line ${input.summary.linePct.toFixed(2)}%, branch ${input.summary.branchPct.toFixed(2)}%; ${changed.detail})`
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

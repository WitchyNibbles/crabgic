import { createCoverageGate } from "./coverage-gate.js";
import { CONVENTIONAL_LCOV_PATH } from "./coverage/coverage-report.js";
import type { CoverageSummary } from "./coverage/types.js";
import type { GateContext, GateVerdict } from "./types.js";
import type { GateRegistry } from "./registry.js";

/**
 * `registerCoverageGate` — the registration `createCoverageGate` could never
 * have, for the same reason `createTddGate` could not
 * (`./tdd-gate-registration.ts`).
 *
 * ⚠️ THE SHAPE MISMATCH, MEASURED. `createCoverageGate` takes `projectId`,
 * `summary` and `diffText` as CONSTRUCTOR arguments. All three are per-attempt —
 * the summary is the report this candidate's own run produced, the diff is this
 * change set's — and `packages/cli/src/daemon/compose-gate-registry.ts` builds
 * ONE registry at startup, before any of them exist. That is why the factory has
 * never had a production call site, and why the composition root records this
 * gate as "better and still absent" after owner ruling R6 improved it.
 *
 * This registrar runs the SAME checks with the SAME thresholds — it delegates to
 * `createCoverageGate` rather than reimplementing them, so there is one
 * definition of the ratchet, the greenfield floor and R6's changed-line rule.
 */

export const COVERAGE_GATE_NAME = "changed-line-coverage";

/** One candidate's measurement: the report its own run produced, and the diff to score against. */
export interface CoverageMeasurement {
  readonly summary: CoverageSummary;
  /**
   * The change set's unified diff. Absent means R6's changed-line check is not
   * run and the verdict says so — `coverage-gate.ts` is explicit that a
   * missing diff is "a check that was never asked", never a check that passed.
   */
  readonly diffText?: string;
}

export interface CoverageGateRegistration {
  /**
   * The stable identifier the ratchet floor is scoped to, resolved at firing
   * time. Never the change-set id: the floor is a property of the PROJECT and
   * must survive across change sets, which is the whole point of a ratchet.
   */
  readonly projectId: (context: GateContext) => string;
  /**
   * Produces this candidate's measurement — runs the suite and reads the report
   * it left behind. `undefined` means nothing could be measured.
   */
  readonly loadCoverage: (context: GateContext) => Promise<CoverageMeasurement | undefined>;
  /** Path prefixes this project's coverage configuration leaves out of the denominator. */
  readonly excludedFromCoverage?: readonly string[];
}

/**
 * Registers the `coverage` handler, marked `perWorkUnit`.
 *
 * ⚠️ AN UNMEASURED CANDIDATE IS REFUSED, and this is the decision that gives the
 * gate its teeth. A candidate whose test command produced no report has not been
 * measured, and passing it would make the gate optional in practice: any project
 * could exempt itself by not configuring a reporter. That is the same escape
 * `coverage-gate.ts` already closes for aggregate-only report formats — "silently
 * exempts itself from the ruling by choosing a reporter" — and it must not be
 * reopened one level up.
 *
 * `perWorkUnit` because the check scores ONE unit's change against ONE
 * candidate's report. `fireAll` skips it; `./post-completion-pipeline.ts` fires
 * it per collected candidate at `verifying`.
 */
export function registerCoverageGate(
  registry: GateRegistry,
  options: CoverageGateRegistration,
): void {
  registry.register(
    "coverage",
    COVERAGE_GATE_NAME,
    async (context): Promise<GateVerdict> => {
      const measured = await options.loadCoverage(context);
      if (measured === undefined) {
        return {
          passed: false,
          command: "coverage:unmeasured",
          exitStatus: 1,
          toolchainFingerprint: "@crabgic/gates",
          artifactDigests: [],
          detail:
            `no coverage report was produced for this candidate — nothing was measured, so ` +
            `nothing can be attested. The granted test command must emit ` +
            `"${CONVENTIONAL_LCOV_PATH}".`,
        };
      }
      // Delegated rather than reimplemented: the ratchet, the greenfield floor
      // and R6's changed-line rule keep ONE definition between them.
      return createCoverageGate({
        projectId: options.projectId(context),
        summary: measured.summary,
        ...(measured.diffText !== undefined ? { diffText: measured.diffText } : {}),
        ...(options.excludedFromCoverage !== undefined
          ? { excludedFromCoverage: options.excludedFromCoverage }
          : {}),
      })(context);
    },
    { perWorkUnit: true },
  );
}

/**
 * Presentation-config check — reports a `.crabgic/presentation.json` that was
 * found and REJECTED.
 *
 * WHY THIS IS A CHECK AND NOT A THROW. `loadPresentationPolicy` falls back to
 * the defaults on every failure, because a malformed config must degrade the
 * presentation rather than break a command. That is the right runtime
 * behaviour and it has one bad consequence on its own: an operator who edits
 * the file, gets a typo wrong, and sees no change has no way to find out why.
 * Silence is the actual defect. This is the channel that breaks it.
 *
 * `warning`, not `error`: nothing is broken, the defaults are in force, and the
 * host is healthy. What is wrong is that an intention was not honoured.
 */
import { loadPresentationPolicy, PRESENTATION_CONFIG_RELPATH } from "@crabgic/contracts";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

const CHECK_ID = "presentation.config";

export interface PresentationConfigCheckOptions {
  /** The project root the config is resolved against. */
  readonly projectRoot: string;
  readonly load?: typeof loadPresentationPolicy;
}

export function createPresentationConfigCheck(
  options: PresentationConfigCheckOptions,
): DoctorCheck {
  const load = options.load ?? loadPresentationPolicy;
  return {
    id: CHECK_ID,
    severity: "warning",
    // The framework's `run()` returns a promise; this check is synchronous and
    // has nothing to await, which is fine — it is the seam that is async.
    async run(): Promise<DoctorFinding> {
      const { source, problems, policy } = load(options.projectRoot);

      if (source === "invalid") {
        return {
          id: CHECK_ID,
          severity: "warning",
          passed: false,
          evidence: `${PRESENTATION_CONFIG_RELPATH} was found but rejected, so the defaults are in force: ${problems.join("; ")}`,
          repairStep: `fix or delete ${PRESENTATION_CONFIG_RELPATH}`,
        };
      }

      if (source === "default") {
        return {
          id: CHECK_ID,
          severity: "warning",
          passed: true,
          evidence: `no ${PRESENTATION_CONFIG_RELPATH}; presentation defaults are in force`,
        };
      }

      // The gate being OFF is reported explicitly rather than passing quietly.
      // A disabled blocking hook is a legitimate choice and an invisible one,
      // and "why did nothing catch that wall" should be answerable here.
      const gate = policy.formatGate;
      return {
        id: CHECK_ID,
        severity: "warning",
        passed: true,
        evidence: `${PRESENTATION_CONFIG_RELPATH} applied; report-format gate ${gate.enabled ? `enabled (${gate.mode})` : "DISABLED"}`,
      };
    },
  };
}

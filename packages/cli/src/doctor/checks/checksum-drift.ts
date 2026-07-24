/**
 * Checksum-drift doctor check — roadmap/10-plugin-and-installer.md §In
 * scope: "Doctor checks contributed (registered into 09's `check = id,
 * severity, evidence, repair step` framework): checksum/drift check,
 * plugin-trust/pin check, CapabilityManifest-digest-freshness check; repair
 * plans are non-destructive-only, matching 09's `--repair-plan`
 * convention." Wraps `../../installer/drift-detector.ts` — this file adds
 * no new detection logic of its own, only the `DoctorCheck` shape.
 */
import { detectDrift } from "../../installer/drift-detector.js";
import { readInstallState } from "../../installer/state-store.js";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

export interface ChecksumDriftCheckOptions {
  readonly targetDir: string;
}

export function createChecksumDriftCheck(options: ChecksumDriftCheckOptions): DoctorCheck {
  return {
    id: "installer.checksum-drift",
    severity: "warning",
    async run(): Promise<DoctorFinding> {
      const state = await readInstallState(options.targetDir);
      if (state === undefined) {
        return {
          id: "installer.checksum-drift",
          severity: "warning",
          passed: true,
          evidence: "not installed in this project — nothing to check",
        };
      }

      const findings = await detectDrift(options.targetDir, state);
      if (findings.length === 0) {
        return {
          id: "installer.checksum-drift",
          severity: "warning",
          passed: true,
          evidence: `all ${state.artifacts.length} tracked artifact(s) match their installed checksum`,
        };
      }

      const paths = findings.map((f) => `${f.relPath} (${f.kind})`).join(", ");
      return {
        id: "installer.checksum-drift",
        severity: "warning",
        passed: false,
        evidence: `drift detected in ${findings.length} artifact(s): ${paths}`,
        repairStep:
          "run `engineering-orchestrator upgrade --dry-run` to review the diff, then `upgrade` to reconcile " +
          "(or `uninstall` if the drift is an intentional local customization you want to keep unmanaged)",
      };
    },
  };
}

/**
 * CapabilityManifest-digest-freshness doctor check —
 * roadmap/10-plugin-and-installer.md §In scope, "Doctor checks
 * contributed": "CapabilityManifest-digest-freshness check." The installed
 * project's own state store (`../../installer/state-store.ts`) records the
 * plugin source's content digest AT INSTALL TIME (`sourceDigest`); this
 * check recomputes it fresh from `pluginSourceDir` right now and flags a
 * stale/drifted manifest digest if the plugin source has since changed
 * without an `upgrade` ever reconciling it.
 */
import { computeContentDigest } from "@eo/plugin";
import { readInstallState } from "../../installer/state-store.js";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

export interface CapabilityManifestFreshnessCheckOptions {
  readonly targetDir: string;
  readonly pluginSourceDir: string;
}

export function createCapabilityManifestFreshnessCheck(
  options: CapabilityManifestFreshnessCheckOptions,
): DoctorCheck {
  return {
    id: "installer.capability-manifest-freshness",
    severity: "warning",
    async run(): Promise<DoctorFinding> {
      const state = await readInstallState(options.targetDir);
      if (state === undefined) {
        return {
          id: "installer.capability-manifest-freshness",
          severity: "warning",
          passed: true,
          evidence: "not installed in this project — nothing to check",
        };
      }

      const freshDigest = computeContentDigest(options.pluginSourceDir);
      if (freshDigest === state.sourceDigest) {
        return {
          id: "installer.capability-manifest-freshness",
          severity: "warning",
          passed: true,
          evidence: `recorded CapabilityManifest digest (${state.sourceDigest.slice(0, 12)}…) matches the current plugin source`,
        };
      }

      return {
        id: "installer.capability-manifest-freshness",
        severity: "warning",
        passed: false,
        evidence:
          `stale CapabilityManifest digest: recorded ${state.sourceDigest.slice(0, 12)}… but the plugin ` +
          `source at "${options.pluginSourceDir}" now digests to ${freshDigest.slice(0, 12)}…`,
        repairStep:
          "run `engineering-orchestrator upgrade` to reconcile the installed state with the current plugin source",
      };
    },
  };
}

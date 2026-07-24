/**
 * Plugin-trust/pin doctor check — roadmap/10-plugin-and-installer.md §In
 * scope, "Doctor checks contributed": "plugin-trust/pin check." Verifies
 * the plugin source's own `marketplace.json` (if present — a vendored
 * `--plugin-dir` source need not ship one) is SHA-pinned per
 * `@eo/plugin`'s `MarketplaceSchema` — the same schema `marketplace.schema
 * .test` validates, reused here rather than re-derived.
 */
import { readMarketplaceJson, MarketplaceSchema } from "@eo/plugin";
import type { DoctorCheck, DoctorFinding } from "../framework.js";

export interface PluginTrustPinCheckOptions {
  readonly pluginSourceDir: string;
}

export function createPluginTrustPinCheck(options: PluginTrustPinCheckOptions): DoctorCheck {
  return {
    id: "installer.plugin-trust-pin",
    severity: "error",
    async run(): Promise<DoctorFinding> {
      let marketplace: unknown;
      try {
        marketplace = readMarketplaceJson(options.pluginSourceDir);
      } catch (err) {
        return {
          id: "installer.plugin-trust-pin",
          severity: "error",
          passed: false,
          evidence: `could not read/parse the plugin source's marketplace.json: ${err instanceof Error ? err.message : String(err)}`,
          repairStep:
            "verify the plugin source directory contains a valid .claude-plugin/marketplace.json",
        };
      }

      const result = MarketplaceSchema.safeParse(marketplace);
      if (!result.success) {
        return {
          id: "installer.plugin-trust-pin",
          severity: "error",
          passed: false,
          evidence: `marketplace.json is not SHA-pinned/schema-valid: ${result.error.issues.map((i) => i.message).join("; ")}`,
          repairStep:
            "re-pin every plugin entry's `commit` field to a full 40-hex-char git commit SHA (never a branch/tag ref) before trusting this source",
        };
      }

      return {
        id: "installer.plugin-trust-pin",
        severity: "error",
        passed: true,
        evidence: `marketplace.json is SHA-pinned (${result.data.plugins.length} plugin entr${result.data.plugins.length === 1 ? "y" : "ies"})`,
      };
    },
  };
}

import { getActiveQuarantine } from "./flake/quarantine-registry.js";
import type { GateHandler } from "./types.js";

export type RerunOutcome = "passed" | "failed";

export interface FlakeGateInput {
  readonly testIdentifier: string;
  readonly initialOutcome: RerunOutcome;
  /** Present only when a rerun was actually attempted after `initialOutcome === "failed"`. */
  readonly rerunOutcome?: RerunOutcome;
}

/**
 * Flake gate — roadmap/14 §In scope, "Flake policy" bullet: "a rerun-then-
 * pass result is marked `unstable` until fixed or explicitly quarantined."
 * "Never silently green" (roadmap/14 §Critical correctness points) is
 * satisfied structurally: a rerun-then-pass verdict ALWAYS sets
 * `unstable: true` on the returned `GateVerdict` (surfacing in the journaled
 * `EvidenceRecord` too, since `../registry.ts` emits the verdict as-is) —
 * whether it also passes or blocks depends ONLY on whether an active
 * quarantine (`./flake/quarantine-registry.ts`) currently exists for the
 * test.
 */
export function createFlakeGate(input: FlakeGateInput): GateHandler {
  return async (context) => {
    const command = `flake-check:${input.testIdentifier}`;
    const toolchainFingerprint = "flake-detector@1";

    if (input.initialOutcome === "passed") {
      return {
        passed: true,
        command,
        exitStatus: 0,
        toolchainFingerprint,
        artifactDigests: [],
        detail: "passed on the first attempt — not flaky",
      };
    }

    if (input.rerunOutcome === undefined) {
      return {
        passed: false,
        command,
        exitStatus: 1,
        toolchainFingerprint,
        artifactDigests: [],
        detail: "failed with no rerun evidence — genuine failure, blocking",
      };
    }

    if (input.rerunOutcome === "failed") {
      return {
        passed: false,
        command,
        exitStatus: 1,
        toolchainFingerprint,
        artifactDigests: [],
        detail: "failed on rerun too — genuine failure (not flake), blocking",
      };
    }

    // rerunOutcome === "passed": a genuine rerun-then-pass result.
    const nowIso = (context.now?.() ?? new Date()).toISOString();
    const quarantine = await getActiveQuarantine(context.journal, input.testIdentifier, nowIso);
    if (quarantine !== undefined) {
      return {
        passed: true,
        unstable: true,
        command,
        exitStatus: 0,
        toolchainFingerprint,
        artifactDigests: [`quarantine:${input.testIdentifier}:expires=${quarantine.expiresAt}`],
        detail: `unstable (rerun-then-pass); suppressed by an active quarantine until ${quarantine.expiresAt}`,
      };
    }
    return {
      passed: false,
      unstable: true,
      command,
      exitStatus: 1,
      toolchainFingerprint,
      artifactDigests: [],
      detail: "unstable (rerun-then-pass); not quarantined — blocking, never silently green",
    };
  };
}

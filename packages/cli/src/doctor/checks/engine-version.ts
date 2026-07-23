/**
 * Engine version-gate check — roadmap/09-cli-and-doctor.md §Doctor checks:
 * "engine present + version within baseline range (`docs/engine-
 * baseline.md`, 00 — citation only, see Interfaces consumed)." §Risks:
 * "Doctor's version-gate check is a doc citation, not a code dependency...
 * this check must be updated by cross-reference, not by import." This is a
 * DIRECT engine probe (`claude --version`, spawned here) — never an import
 * of `@eo/engine-claude` (per this phase's own governing instructions).
 */
import { CliUsageError } from "../../errors.js";
import type { DoctorCheck, DoctorFinding } from "../framework.js";
import type { ProcessProbeFn } from "../process-probe.js";

/** `docs/engine-baseline.md` §"Full verdict tally" / §10's own recorded accepted range — cited here verbatim, never re-derived from memory. Update this constant only by cross-reference to a re-verified `docs/engine-baseline.md`. */
export const ENGINE_BASELINE_ACCEPTED_RANGE = { min: "2.1.207", max: "2.1.210" } as const;

function parseSemverTriple(version: string): readonly [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) {
    throw new CliUsageError(`could not parse a semver triple out of "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

export function isVersionWithinRange(
  version: string,
  range: { readonly min: string; readonly max: string },
): boolean {
  const parsed = parseSemverTriple(version);
  return (
    compareSemver(parsed, parseSemverTriple(range.min)) >= 0 &&
    compareSemver(parsed, parseSemverTriple(range.max)) <= 0
  );
}

export interface EngineVersionCheckOptions {
  readonly probe: ProcessProbeFn;
  readonly acceptedRange?: { readonly min: string; readonly max: string };
}

export function createEngineVersionCheck(options: EngineVersionCheckOptions): DoctorCheck {
  const range = options.acceptedRange ?? ENGINE_BASELINE_ACCEPTED_RANGE;
  return {
    id: "engine.version",
    severity: "error",
    async run(): Promise<DoctorFinding> {
      const result = await options.probe("claude", ["--version"]);
      if (result.exitCode !== 0) {
        return {
          id: "engine.version",
          severity: "error",
          passed: false,
          evidence: `"claude --version" exited ${String(result.exitCode)}: ${result.stderr.trim()}`,
          repairStep: "install Claude Code and ensure `claude` is on PATH",
        };
      }
      let withinRange: boolean;
      try {
        withinRange = isVersionWithinRange(result.stdout, range);
      } catch {
        return {
          id: "engine.version",
          severity: "error",
          passed: false,
          evidence: `could not parse a version out of "${result.stdout.trim()}"`,
          repairStep: `install a Claude Code version within ${range.min}–${range.max} (docs/engine-baseline.md)`,
        };
      }
      if (!withinRange) {
        return {
          id: "engine.version",
          severity: "error",
          passed: false,
          evidence: `"${result.stdout.trim()}" is outside the accepted range ${range.min}–${range.max}`,
          repairStep: `install a Claude Code version within ${range.min}–${range.max} (docs/engine-baseline.md)`,
        };
      }
      return {
        id: "engine.version",
        severity: "error",
        passed: true,
        evidence: `"${result.stdout.trim()}" is within the accepted range ${range.min}–${range.max}`,
      };
    },
  };
}

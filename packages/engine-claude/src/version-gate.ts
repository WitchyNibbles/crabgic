/**
 * `version-gate` — roadmap/06-claude-engine-adapter.md §In scope, "Version
 * gate": "`EngineCapabilities.engineVersion` checked against
 * `docs/engine-baseline.md`'s accepted range; `spawn`/`resume` refuse
 * outside it." Exit criterion `version-gate.test`: "`spawn`/`resume`
 * refuse to start outside `docs/engine-baseline.md`'s accepted version
 * range." README design decision 9: the range constants live here, and a
 * dedicated test (`version-gate.test.ts`'s "baseline-sync" suite) parses
 * `docs/engine-baseline.md` and fails if these constants drift from the
 * document — the document stays the single citable source (CLAUDE.md's
 * engine-fact-drift ground rule), this module is its typed mirror.
 *
 * No semver dependency: engine/SDK versions here are always plain
 * `<major>.<minor>.<patch>` numeric triples (docs/engine-baseline.md's own
 * observed forms, `2.1.210`/`0.3.210`), so a small numeric-triple
 * comparator is sufficient and keeps this package dependency-free for the
 * comparison itself.
 */

/** A `<min>`–`<max>` accepted version range, both endpoints inclusive. */
export interface EngineVersionRange {
  readonly min: string;
  readonly max: string;
}

/**
 * The accepted `claude` CLI / engine version range (docs/engine-baseline.md
 * headline: "Accepted range: **2.1.207–2.1.210**").
 */
export const ACCEPTED_ENGINE_VERSION_RANGE: EngineVersionRange = { min: "2.1.207", max: "2.1.210" };

/**
 * The accepted `@anthropic-ai/claude-agent-sdk` version range
 * (docs/engine-baseline.md §10: "`@anthropic-ai/claude-agent-sdk` moves
 * outside 0.3.207–0.3.210").
 */
export const ACCEPTED_SDK_VERSION_RANGE: EngineVersionRange = { min: "0.3.207", max: "0.3.210" };

/**
 * The exact engine version phase 00's baseline was verified against
 * (docs/engine-baseline.md headline: "Tested version:** `claude` CLI
 * **2.1.210**").
 */
export const TESTED_ENGINE_VERSION = "2.1.210";

/**
 * Thrown by `assertEngineVersionAccepted` when a version string is either
 * malformed (not a plain `<major>.<minor>.<patch>` numeric triple) or
 * well-formed but outside `ACCEPTED_ENGINE_VERSION_RANGE`. `reason`
 * distinguishes the two cases for callers that need to react differently
 * (e.g. a malformed string may indicate a probe/parsing bug upstream,
 * whereas an out-of-range version is the release-velocity risk
 * roadmap/06 §Risks risk 1 names).
 */
export class EngineVersionRejectedError extends Error {
  constructor(
    readonly version: string,
    readonly acceptedRange: EngineVersionRange,
    readonly reason: "malformed" | "out-of-range",
  ) {
    super(
      reason === "malformed"
        ? `engine version string is malformed (expected "<major>.<minor>.<patch>"): ${JSON.stringify(version)}`
        : `engine version ${JSON.stringify(version)} is outside the accepted range ` +
            `${acceptedRange.min}–${acceptedRange.max} (docs/engine-baseline.md)`,
    );
    this.name = "EngineVersionRejectedError";
  }
}

type VersionTriple = readonly [number, number, number];

const VERSION_TRIPLE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersionTriple(version: string): VersionTriple {
  const match = VERSION_TRIPLE_PATTERN.exec(version);
  if (match === null) {
    throw new EngineVersionRejectedError(version, ACCEPTED_ENGINE_VERSION_RANGE, "malformed");
  }
  const majorText = match[1];
  const minorText = match[2];
  const patchText = match[3];
  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    throw new EngineVersionRejectedError(version, ACCEPTED_ENGINE_VERSION_RANGE, "malformed");
  }
  return [Number(majorText), Number(minorText), Number(patchText)];
}

/** Numeric triple comparison: negative if `a < b`, positive if `a > b`, 0 if equal. */
function compareVersionTriples(a: VersionTriple, b: VersionTriple): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Refuses (throws `EngineVersionRejectedError`) a `version` string that is
 * either malformed or outside `ACCEPTED_ENGINE_VERSION_RANGE`. Callers
 * (`spawn`/`resume`) must call this BEFORE any engine invocation
 * (roadmap/06 §In scope, "Version gate").
 */
export function assertEngineVersionAccepted(version: string): void {
  const triple = parseVersionTriple(version);
  const min = parseVersionTriple(ACCEPTED_ENGINE_VERSION_RANGE.min);
  const max = parseVersionTriple(ACCEPTED_ENGINE_VERSION_RANGE.max);

  if (compareVersionTriples(triple, min) < 0 || compareVersionTriples(triple, max) > 0) {
    throw new EngineVersionRejectedError(version, ACCEPTED_ENGINE_VERSION_RANGE, "out-of-range");
  }
}

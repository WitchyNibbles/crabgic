import type { StackEvidence } from "@eo/contracts";

export type CoverageAdapterKind = "lcov" | "istanbul" | "go-cover" | "pytest-cov";

/** Lower-cased ecosystem strings present in `stackEvidence.findings` — the shared primitive both coverage-adapter and security-category selection key off (`StackEvidence` says *whether* a category applies at all; `ProjectProfile` says *how* to run it — roadmap/14 §Risks). */
export function ecosystemsPresent(stackEvidence: StackEvidence): ReadonlySet<string> {
  return new Set(stackEvidence.findings.map((f) => f.ecosystem.toLowerCase()));
}

/**
 * Selects which coverage adapter applies, `StackEvidence`-driven
 * (roadmap/14 §In scope, "Test execution" bullet). `node`/`javascript`/
 * `typescript` evidence selects `istanbul` (this repo's own vitest/c8
 * convention) by default, or `lcov` when explicitly requested via
 * `preferLcov` (nyc/c8-lcov-reporter toolchains); `go` selects `go-cover`;
 * `python` selects `pytest-cov`. Returns `undefined` when no known
 * ecosystem is present — the coverage gate then has nothing to run
 * (mirrors "no JS-specific SAST ruleset fires without Node evidence").
 */
export function selectCoverageAdapter(
  stackEvidence: StackEvidence,
  options?: { readonly preferLcov?: boolean },
): CoverageAdapterKind | undefined {
  const ecosystems = ecosystemsPresent(stackEvidence);
  if (ecosystems.has("go")) return "go-cover";
  if (ecosystems.has("python")) return "pytest-cov";
  if (ecosystems.has("node") || ecosystems.has("javascript") || ecosystems.has("typescript")) {
    return options?.preferLcov === true ? "lcov" : "istanbul";
  }
  return undefined;
}

/**
 * Normalized coverage-adapter output — every adapter in this directory
 * (`lcov-adapter.ts`, `istanbul-adapter.ts`, `go-cover-adapter.ts`,
 * `pytest-cov-adapter.ts`) parses its own tool's raw report format down to
 * this one shape, per roadmap/14 §In scope, "Coverage" bullet: "≥80%
 * line+branch on greenfield projects."
 */
export interface CoverageSummary {
  readonly linePct: number;
  readonly branchPct: number;
  /** e.g. "lcov", "istanbul", "go-cover", "pytest-cov" — becomes part of the gate's `EvidenceRecord.toolchainFingerprint`. */
  readonly toolchain: string;
  /**
   * Per-file, per-line hit counts — owner ruling R6's second ingredient, and
   * ABSENT for a report format that does not carry it.
   *
   * Optional because it is a property of the FORMAT, not of the adapter's
   * effort: LCOV's `SF:`/`DA:<line>,<hits>` records and Go's cover-profile
   * ranges carry per-line data, while istanbul's `coverage-summary.json` and
   * coverage.py's `totals` block are aggregates with no line detail to recover.
   *
   * ⚠️ Absence must never read as "nothing changed" or "everything covered".
   * `./changed-line-coverage.ts` returns a typed `no-line-data` outcome the gate
   * turns into a REFUSAL, because a check that silently passes whenever its
   * input is missing is the vacuity this repository's playbook exists to refuse.
   */
  readonly lines?: FileLineCoverage;
}

/** Path → (1-based line number → hit count). A line ABSENT from the inner map is not instrumentable. */
export type FileLineCoverage = ReadonlyMap<string, ReadonlyMap<number, number>>;

export function assertValidPct(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`coverage: ${label} must be a finite percentage in [0,100], got ${String(value)}`);
  }
}

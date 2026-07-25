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
}

export function assertValidPct(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`coverage: ${label} must be a finite percentage in [0,100], got ${String(value)}`);
  }
}

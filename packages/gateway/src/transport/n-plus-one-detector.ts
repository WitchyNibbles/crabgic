/**
 * N+1 detection — roadmap/16-gateway-core.md §In scope, "Transport
 * security": "N+1 detection." Work item 2.
 *
 * Tracks per-logical-operation request counts within a bounded window (a
 * single mutation-pipeline apply, or a single query call) and flags when
 * the same `(operationLabel, resourceKind)` pair issues more individual
 * requests than a configured threshold in proportion to the number of
 * "parent" items processed — the classic N+1 signature (one list request
 * followed by N per-item detail requests instead of a single batched
 * fetch).
 */

export interface NPlusOneDetectorOptions {
  /** Per-parent-item request count above which this is flagged as a likely N+1 pattern. Default 1 (i.e. more than one child request per parent item is suspicious). */
  readonly maxChildRequestsPerParent?: number;
}

export interface NPlusOneReport {
  readonly flagged: boolean;
  readonly childRequestCount: number;
  readonly parentItemCount: number;
  readonly ratio: number;
}

/**
 * A scoped counter for one logical operation. Call `recordParentItems`
 * once with the count of top-level items a list call returned, then
 * `recordChildRequest` once per subsequent per-item request; `report()`
 * flags when the ratio exceeds the configured threshold.
 */
export class NPlusOneDetector {
  readonly #maxChildRequestsPerParent: number;
  #parentItemCount = 0;
  #childRequestCount = 0;

  constructor(options: NPlusOneDetectorOptions = {}) {
    this.#maxChildRequestsPerParent = options.maxChildRequestsPerParent ?? 1;
  }

  recordParentItems(count: number): void {
    this.#parentItemCount += count;
  }

  recordChildRequest(): void {
    this.#childRequestCount += 1;
  }

  report(): NPlusOneReport {
    const ratio = this.#parentItemCount === 0 ? this.#childRequestCount : this.#childRequestCount / this.#parentItemCount;
    return {
      flagged: this.#parentItemCount > 0 && ratio > this.#maxChildRequestsPerParent,
      childRequestCount: this.#childRequestCount,
      parentItemCount: this.#parentItemCount,
      ratio,
    };
  }
}

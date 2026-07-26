import type { GrafanaParsedResource } from "../resources/resource-definitions.js";

/**
 * Rollback-snapshot store — roadmap/20-grafana-adapters.md §In scope,
 * "Mutation safety": "capture resourceVersion/ETag/dashboard-version + a
 * rollback snapshot before every update." Keyed by `RemoteMutationPlan.id`
 * — one snapshot per planned update, captured BEFORE the update's HTTP
 * call is ever issued, so a failed/misverified update always has something
 * to restore from.
 *
 * Deliberately in-memory only at this phase (mirrors `@eo/gateway`'s own
 * `ProviderRegistry`/`CapabilitySnapshotCache` in-process scope) — a
 * durable, crash-surviving snapshot store is a 21/23 integration concern
 * this phase's own evidence notes flag as a carry-forward, not a gap in
 * THIS phase's contract (roadmap/20 names 16's journal as the durability
 * layer for the mutation pipeline itself; this store is this connector's
 * OWN pre-mutation bookkeeping, layered on top of that).
 *
 * WP5 (2026-07-25) discharges that carry-forward:
 * `./file-backed-store.js`'s `createFileGrafanaRollbackSnapshotStore` is
 * the durable drop-in the shipped `gateway mcp` server wires, and the
 * class below stays the in-memory one tests and fixtures use.
 */

/**
 * The contract every rollback-snapshot store satisfies. Named for the same
 * reason `GrafanaPlanPayloadStoreLike` is: the class's `#private` field
 * makes its type nominal, so a durable drop-in cannot be assigned to it
 * structurally.
 */
export interface GrafanaRollbackSnapshotStoreLike {
  capture(planId: string, snapshot: GrafanaParsedResource): void;
  get(planId: string): GrafanaParsedResource | undefined;
  clear(planId: string): void;
  readonly size: number;
}

export class GrafanaRollbackSnapshotStore implements GrafanaRollbackSnapshotStoreLike {
  readonly #snapshots = new Map<string, GrafanaParsedResource>();

  capture(planId: string, snapshot: GrafanaParsedResource): void {
    this.#snapshots.set(planId, snapshot);
  }

  get(planId: string): GrafanaParsedResource | undefined {
    return this.#snapshots.get(planId);
  }

  clear(planId: string): void {
    this.#snapshots.delete(planId);
  }

  get size(): number {
    return this.#snapshots.size;
  }
}

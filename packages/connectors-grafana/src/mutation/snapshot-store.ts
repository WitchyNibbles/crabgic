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
 */
export class GrafanaRollbackSnapshotStore {
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

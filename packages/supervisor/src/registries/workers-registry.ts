/**
 * Workers registry — roadmap/05-supervisor-daemon.md §Registries:
 * "workers (carrying the engine `session_id`)." Keyed by this phase's own
 * supervisor-assigned `workerId` (distinct from the engine's own
 * `sessionId`, which is one field carried on the `WorkerRecord` value, not
 * the registry key — a worker can in principle be re-spawned against the
 * same `sessionId` via `resume`, so the two identities are kept separate).
 */
import type { WorkerRecord } from "../router/operations.js";

export interface WorkersRegistry {
  get(workerId: string): WorkerRecord | undefined;
  list(): readonly WorkerRecord[];
  query(predicate: (worker: WorkerRecord) => boolean): readonly WorkerRecord[];
  /** Immutable-replace: always writes a whole new `WorkerRecord`, never patches a field in place. */
  upsert(record: WorkerRecord): void;
}

export function createWorkersRegistry(): WorkersRegistry {
  const items = new Map<string, WorkerRecord>();
  return {
    get(workerId) {
      return items.get(workerId);
    },
    list() {
      return Array.from(items.values());
    },
    query(predicate) {
      return Array.from(items.values()).filter(predicate);
    },
    upsert(record) {
      items.set(record.workerId, record);
    },
  };
}

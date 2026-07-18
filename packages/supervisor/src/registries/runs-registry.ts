/**
 * Runs registry — roadmap/05-supervisor-daemon.md §Registries: "runs,
 * change sets, work units, workers... artifact index." Keyed by `runId`
 * (not the generic `Registry<T>`'s `id` field — no `Run` contract exists
 * among `@eo/contracts`'s 21 schemas, per `RunSnapshot`'s own doc comment:
 * "`runId` is an opaque identifier the supervisor (05) assigns to a run");
 * `RunRecordSchema` (`../router/operations.ts`) is this phase's own
 * minimal-sufficient read shape, not `RunSnapshot` itself — a `RunRecord`
 * is this registry's live, in-memory "current known state of a run" view,
 * rebuilt from `RunSnapshot`/journal replay on recovery
 * (`./recovery.ts`), never the durable snapshot record 04 itself owns.
 */
import type { RunRecord } from "../router/operations.js";

export interface RunsRegistry {
  get(runId: string): RunRecord | undefined;
  list(): readonly RunRecord[];
  /** Immutable-replace: always writes a whole new `RunRecord`, never patches a field in place. */
  upsert(record: RunRecord): void;
}

export function createRunsRegistry(): RunsRegistry {
  const items = new Map<string, RunRecord>();
  return {
    get(runId) {
      return items.get(runId);
    },
    list() {
      return Array.from(items.values());
    },
    upsert(record) {
      items.set(record.runId, record);
    },
  };
}

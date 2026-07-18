/**
 * Generic in-memory, id-keyed registry — the backing store every
 * `./*-registry.ts` module (runs, change sets, work units, workers,
 * artifact index) wraps. Roadmap/05-supervisor-daemon.md work item 3's
 * own failing-first framing: "a query on an empty registry returns empty,
 * not a throw." `put()` always replaces the whole item for a given id
 * (immutable-replace, matching this repo's "never mutate in place"
 * convention) — never a partial in-place field update.
 */
export interface Registry<T> {
  get(id: string): T | undefined;
  list(): readonly T[];
  put(item: T): void;
  query(predicate: (item: T) => boolean): readonly T[];
}

export function createInMemoryRegistry<T extends { readonly id: string }>(): Registry<T> {
  const items = new Map<string, T>();
  return {
    get(id) {
      return items.get(id);
    },
    list() {
      return Array.from(items.values());
    },
    put(item) {
      items.set(item.id, item);
    },
    query(predicate) {
      return Array.from(items.values()).filter(predicate);
    },
  };
}

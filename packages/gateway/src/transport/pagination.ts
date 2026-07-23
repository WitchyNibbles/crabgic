/**
 * O(page) pagination — roadmap/16-gateway-core.md §In scope, "Transport
 * security": "O(page) pagination." Exit criterion: "pagination memory
 * stays O(page) on a 10k-item fake." Work item 2.
 *
 * `paginate` is an async generator: it fetches and yields ONE page at a
 * time, never accumulating prior pages — the caller (a query/aggregation
 * layer) decides whether to buffer the flattened stream itself, but this
 * primitive's own resident memory never exceeds the size of the page
 * currently in hand plus its own loop-local bookkeeping (page-count,
 * cursor), regardless of how many total items or pages exist upstream.
 */

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export type FetchPage<T> = (cursor: string | undefined) => Promise<Page<T>>;

const DEFAULT_MAX_PAGES = 100_000;

/**
 * Yields each page's `items` array in turn. Guards against an infinite
 * loop from a misbehaving upstream that never stops returning a
 * `nextCursor` via `maxPages` (default effectively unbounded for
 * legitimate use, but never literally infinite).
 */
export async function* paginate<T>(
  fetchPage: FetchPage<T>,
  options: { readonly maxPages?: number } = {},
): AsyncGenerator<readonly T[], void, void> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    if (pageCount >= maxPages) {
      throw new Error(`paginate: exceeded maxPages (${maxPages}) without exhausting nextCursor`);
    }
    const page = await fetchPage(cursor);
    pageCount += 1;
    yield page.items;
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}

/** Convenience: flattens `paginate` into one array. NOT itself O(page) memory — callers needing the O(page) guarantee must consume `paginate` directly, one page at a time; this helper exists for small/bounded fixtures and tests only. */
export async function collectAllPages<T>(fetchPage: FetchPage<T>): Promise<readonly T[]> {
  const all: T[] = [];
  for await (const items of paginate(fetchPage)) {
    all.push(...items);
  }
  return all;
}

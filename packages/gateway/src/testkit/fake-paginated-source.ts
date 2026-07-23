/**
 * A scriptable paginated fixture — roadmap/16-gateway-core.md §Exit
 * criteria: "pagination memory stays O(page) on a 10k-item fake." The
 * committed testkit artifact that exit criterion's own test
 * (`../transport/pagination.test.ts`) and 18/20's own pagination tests
 * are built against, rather than each reinventing an ad hoc page source.
 */

import type { FetchPage, Page } from "../transport/pagination.js";

/** Builds a `FetchPage` over `totalItems` sequential integers, `pageSize` per page. */
export function createFakePaginatedSource(totalItems: number, pageSize: number): FetchPage<number> {
  return async (cursor: string | undefined): Promise<Page<number>> => {
    const start = cursor === undefined ? 0 : Number(cursor);
    const end = Math.min(start + pageSize, totalItems);
    const items = Array.from({ length: end - start }, (_, i) => start + i);
    return end < totalItems ? { items, nextCursor: String(end) } : { items };
  };
}

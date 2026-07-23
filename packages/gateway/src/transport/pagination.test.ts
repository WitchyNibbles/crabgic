import { describe, expect, it } from "vitest";
import { collectAllPages, paginate, type Page } from "./pagination.js";

function makeFakeSource(totalItems: number, pageSize: number): (cursor: string | undefined) => Promise<Page<number>> {
  return async (cursor) => {
    const start = cursor === undefined ? 0 : Number(cursor);
    const end = Math.min(start + pageSize, totalItems);
    const items = Array.from({ length: end - start }, (_, i) => start + i);
    return end < totalItems ? { items, nextCursor: String(end) } : { items };
  };
}

describe("paginate", () => {
  it("yields items page by page and terminates when nextCursor is absent", async () => {
    const fetchPage = makeFakeSource(10, 4);
    const pages: number[][] = [];
    for await (const items of paginate(fetchPage)) {
      pages.push([...items]);
    }
    expect(pages).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
  });

  it("handles a single-page source", async () => {
    const fetchPage = makeFakeSource(3, 10);
    const pages: number[][] = [];
    for await (const items of paginate(fetchPage)) {
      pages.push([...items]);
    }
    expect(pages).toEqual([[0, 1, 2]]);
  });

  it("handles an empty source", async () => {
    const fetchPage = makeFakeSource(0, 10);
    const pages: number[][] = [];
    for await (const items of paginate(fetchPage)) {
      pages.push([...items]);
    }
    expect(pages).toEqual([[]]);
  });

  it("throws when maxPages is exceeded (misbehaving upstream never stops)", async () => {
    const neverEnds = async (): Promise<Page<number>> => ({ items: [1], nextCursor: "again" });
    const iterate = async () => {
      for await (const _ of paginate(neverEnds, { maxPages: 3 })) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(/exceeded maxPages/);
  });

  it("stays O(page): resident buffered items never exceed one page's worth at a time", async () => {
    const pageSize = 50;
    const totalItems = 10_000;
    const fetchPage = makeFakeSource(totalItems, pageSize);
    let maxObservedPageLength = 0;
    let totalYielded = 0;

    for await (const items of paginate(fetchPage)) {
      maxObservedPageLength = Math.max(maxObservedPageLength, items.length);
      totalYielded += items.length;
    }

    expect(maxObservedPageLength).toBeLessThanOrEqual(pageSize);
    expect(totalYielded).toBe(totalItems);
  });
});

describe("collectAllPages", () => {
  it("flattens every page into one array, in order", async () => {
    const fetchPage = makeFakeSource(7, 3);
    const all = await collectAllPages(fetchPage);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

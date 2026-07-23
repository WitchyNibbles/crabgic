import { describe, expect, it } from "vitest";
import { WriteSerializer } from "./write-serializer.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WriteSerializer", () => {
  it("preserves submission order for the same tenant+resource key under concurrency", async () => {
    const serializer = new WriteSerializer();
    const order: number[] = [];
    const key = { tenant: "t1", resource: "issue:EX-1" };

    const tasks = [5, 1, 4, 2].map((delayMs, index) =>
      serializer.runExclusive(key, async () => {
        await delay(delayMs);
        order.push(index);
      }),
    );

    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("runs writes for different keys fully concurrently (no cross-key blocking)", async () => {
    const serializer = new WriteSerializer();
    const started: string[] = [];
    const key1 = { tenant: "t1", resource: "issue:EX-1" };
    const key2 = { tenant: "t1", resource: "issue:EX-2" };

    const p1 = serializer.runExclusive(key1, async () => {
      started.push("k1-start");
      await delay(20);
      started.push("k1-end");
    });
    const p2 = serializer.runExclusive(key2, async () => {
      started.push("k2-start");
      await delay(5);
      started.push("k2-end");
    });

    await Promise.all([p1, p2]);
    // k2 (shorter delay, different key) finishes before k1 despite
    // starting after it — proving the two keys ran concurrently, not
    // serialized behind one global lock.
    expect(started.indexOf("k2-end")).toBeLessThan(started.indexOf("k1-end"));
  });

  it("a failed task does not block subsequent tasks for the same key", async () => {
    const serializer = new WriteSerializer();
    const key = { tenant: "t1", resource: "issue:EX-1" };
    const results: string[] = [];

    const first = serializer.runExclusive(key, async () => {
      throw new Error("boom");
    });
    const second = serializer.runExclusive(key, async () => {
      results.push("second-ran");
      return "ok";
    });

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(results).toEqual(["second-ran"]);
  });

  it("distinguishes tenant boundaries: same resource name, different tenant, run concurrently", async () => {
    const serializer = new WriteSerializer();
    const started: string[] = [];

    const p1 = serializer.runExclusive({ tenant: "tenant-a", resource: "issue:1" }, async () => {
      started.push("a-start");
      await delay(20);
      started.push("a-end");
    });
    const p2 = serializer.runExclusive({ tenant: "tenant-b", resource: "issue:1" }, async () => {
      started.push("b-start");
      await delay(5);
      started.push("b-end");
    });

    await Promise.all([p1, p2]);
    expect(started.indexOf("b-end")).toBeLessThan(started.indexOf("a-end"));
  });

  it("activeKeyCount reflects distinct keys seen", async () => {
    const serializer = new WriteSerializer();
    await serializer.runExclusive({ tenant: "t1", resource: "r1" }, async () => undefined);
    await serializer.runExclusive({ tenant: "t1", resource: "r2" }, async () => undefined);
    expect(serializer.activeKeyCount).toBe(2);
  });
});

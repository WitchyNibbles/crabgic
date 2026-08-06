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

/**
 * Multi-key acquisition — the primitive behind roadmap/18 exit criterion
 * 10's `bulk:<keys>` residual (a bulk write must take EVERY member
 * issue's mutex).
 *
 * DISCIPLINE: every case below uses a DEFERRED-PROMISE barrier, never a
 * wall-clock hold, and no case asserts a duration. (The `delay()`-based
 * cases above pre-date this file's current rules and are left alone.)
 * Each "is serialized" claim is paired with a non-member CONTROL that is
 * green with or without the fix — without it, instrumentation that can
 * never observe overlap would satisfy the serialization claims for free.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("WriteSerializer.runExclusiveMulti", () => {
  it("a queued single-key task on a MEMBER key does not start until the multi-key holder releases", async () => {
    const serializer = new WriteSerializer();
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });

    const multi = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:A" },
        { tenant: "t", resource: "issue:B" },
      ],
      async () => {
        events.push("multi-start");
        await held;
        events.push("multi-end");
      },
    );
    // issue:B is the LAST key in sorted order — a "lock only the first
    // key" implementation must fail here rather than pass by accident.
    const single = serializer.runExclusive({ tenant: "t", resource: "issue:B" }, async () => {
      events.push("single-ran");
    });

    await flushMicrotasks();
    expect(events).toEqual(["multi-start"]);

    release();
    await Promise.all([multi, single]);
    expect(events).toEqual(["multi-start", "multi-end", "single-ran"]);
  });

  it("CONTROL: a single-key task on a NON-member key runs while the multi task is still held", async () => {
    const serializer = new WriteSerializer();
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });

    const multi = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:A" },
        { tenant: "t", resource: "issue:B" },
      ],
      async () => {
        events.push("multi-start");
        await held;
        events.push("multi-end");
      },
    );
    const single = serializer.runExclusive({ tenant: "t", resource: "issue:C" }, async () => {
      events.push("single-ran");
    });

    await flushMicrotasks();
    // The non-member ran BEFORE the holder released — this is what rules
    // out a global mutex, and proves the member case above is not passing
    // because nothing can ever interleave.
    expect(events).toEqual(["multi-start", "single-ran"]);

    release();
    await Promise.all([multi, single]);
    expect(events).toEqual(["multi-start", "single-ran", "multi-end"]);
  });

  it("CONTROL: a multi-key task whose key set is DISJOINT from a held one runs immediately", async () => {
    const serializer = new WriteSerializer();
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });

    const first = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:A" },
        { tenant: "t", resource: "issue:B" },
      ],
      async () => {
        events.push("first-start");
        await held;
        events.push("first-end");
      },
    );
    const second = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:C" },
        { tenant: "t", resource: "issue:D" },
      ],
      async () => {
        events.push("second-ran");
      },
    );

    await flushMicrotasks();
    expect(events).toEqual(["first-start", "second-ran"]);
    release();
    await Promise.all([first, second]);
  });

  it("two multi-key tasks sharing ONE member key are serialized", async () => {
    const serializer = new WriteSerializer();
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });

    const first = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:A" },
        { tenant: "t", resource: "issue:B" },
      ],
      async () => {
        events.push("first-start");
        await held;
        events.push("first-end");
      },
    );
    const second = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:B" },
        { tenant: "t", resource: "issue:C" },
      ],
      async () => {
        events.push("second-ran");
      },
    );

    await flushMicrotasks();
    expect(events).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-ran"]);
  });

  it("DEADLOCK PIN: reversed-order key sets ([A,B] then [B,A]) both complete", async () => {
    // The BEHAVIORAL pin for `runExclusiveMulti`'s deadlock-freedom note.
    // Deliberately agnostic about WHICH mechanism supplies the property
    // (atomic registration, or the sorted/deduped key set): any design
    // that CAN deadlock hangs here and times the suite out.
    const serializer = new WriteSerializer();
    const order: string[] = [];

    const forward = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:A" },
        { tenant: "t", resource: "issue:B" },
      ],
      async () => {
        order.push("forward");
      },
    );
    const reversed = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:B" },
        { tenant: "t", resource: "issue:A" },
      ],
      async () => {
        order.push("reversed");
      },
    );

    await Promise.all([forward, reversed]);
    // Both completed, and in submission order — the reversed listing did
    // not mint a distinct lock that let it slip past the forward one.
    expect(order).toEqual(["forward", "reversed"]);
  });

  it("a REJECTING multi-key task blocks no later task on ANY member key", async () => {
    const serializer = new WriteSerializer();
    const ran: string[] = [];

    const failing = serializer.runExclusiveMulti(
      [
        { tenant: "t", resource: "issue:A" },
        { tenant: "t", resource: "issue:B" },
      ],
      async () => {
        throw new Error("boom");
      },
    );
    const onA = serializer.runExclusive({ tenant: "t", resource: "issue:A" }, async () => {
      ran.push("a");
      return "a-ok";
    });
    const onB = serializer.runExclusive({ tenant: "t", resource: "issue:B" }, async () => {
      ran.push("b");
      return "b-ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(onA).resolves.toBe("a-ok");
    await expect(onB).resolves.toBe("b-ok");
    expect(ran).toEqual(["a", "b"]);
  });

  it("duplicate keys in the set are deduplicated and the task runs exactly once", async () => {
    const serializer = new WriteSerializer();
    let calls = 0;
    const key = { tenant: "t", resource: "issue:A" };

    await expect(
      serializer.runExclusiveMulti([key, key, { ...key }], async () => {
        calls += 1;
        return "done";
      }),
    ).resolves.toBe("done");

    expect(calls).toBe(1);
    // One key registered, not three — the dedup is observable, not just
    // an internal detail. (A task that waited on its OWN freshly-set tail
    // would never resolve, so the resolution above is the stronger half.)
    expect(serializer.activeKeyCount).toBe(1);
  });

  it("an EMPTY key set runs the task rather than leaving it queued forever", async () => {
    const serializer = new WriteSerializer();
    await expect(serializer.runExclusiveMulti([], async () => "ran")).resolves.toBe("ran");
    expect(serializer.activeKeyCount).toBe(0);
  });

  it("runExclusive and runExclusiveMulti share ONE queue for the same key", async () => {
    // `runExclusive` delegates to `runExclusiveMulti`; this pins that
    // they are not two independent chains that could drift apart.
    const serializer = new WriteSerializer();
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });

    const single = serializer.runExclusive({ tenant: "t", resource: "issue:A" }, async () => {
      events.push("single-start");
      await held;
      events.push("single-end");
    });
    const multi = serializer.runExclusiveMulti([{ tenant: "t", resource: "issue:A" }], async () => {
      events.push("multi-ran");
    });

    await flushMicrotasks();
    expect(events).toEqual(["single-start"]);
    release();
    await Promise.all([single, multi]);
    expect(events).toEqual(["single-start", "single-end", "multi-ran"]);
  });
});

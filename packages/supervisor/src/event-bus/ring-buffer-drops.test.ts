import { describe, expect, it } from "vitest";
import { createRingBuffer } from "./ring-buffer.js";

describe("ring buffer — capacity/eviction/drop math", () => {
  it("evicts the oldest entries once capacity is exceeded", async () => {
    // Each line is 6 bytes ("aaaaa\n" not used here — plain strings).
    // Capacity 20 bytes, 5-byte lines -> holds at most 4 at a time.
    const buffer = createRingBuffer(20);
    for (let i = 0; i < 10; i++) {
      await buffer.push("aaaaa"); // 5 bytes each
    }
    expect(buffer.size).toBeLessThanOrEqual(20);
  });

  it("a subscriber that joins after entries were already evicted counts drops, never throws", async () => {
    const buffer = createRingBuffer(15); // holds ~3 five-byte lines
    for (let i = 0; i < 5; i++) {
      await buffer.push("aaaaa");
    }
    const sub = buffer.subscribe(); // joins late — some entries already evicted
    const polled = sub.poll();
    expect(polled.length).toBeGreaterThan(0);
    expect(polled.length).toBeLessThanOrEqual(5);
  });

  it("a subscriber that never polls while many entries are pushed accumulates a nonzero drop count once it does poll", async () => {
    const buffer = createRingBuffer(15); // holds ~3 five-byte lines
    const sub = buffer.subscribe();
    sub.poll(); // catch up to empty state first

    for (let i = 0; i < 20; i++) {
      await buffer.push("aaaaa");
    }
    const polled = sub.poll();
    expect(sub.drops).toBeGreaterThan(0);
    expect(polled.length).toBeGreaterThan(0); // still gets whatever survived
  });

  it("reports the EXACT drop count for a subscriber that has fallen behind — not merely 'greater than 0'", async () => {
    // Capacity 30 bytes, 5-byte lines ("aaaaa") -> holds at most 6 entries
    // (5*6=30) once stable; the 7th push evicts the entry at seq 0, etc.
    const buffer = createRingBuffer(30);
    const sub = buffer.subscribe();

    // Push seq 0,1,2 and fully consume them -> cursor lands exactly on seq 2.
    for (let i = 0; i < 3; i++) {
      await buffer.push("aaaaa");
    }
    expect(sub.poll().length).toBe(3);

    // Push seq 3..19 (17 more pushes) with NO further polling. Capacity 6
    // means only the last 6 pushed (seq 14..19) survive; seq 3..13 — 11
    // entries, inclusive — are evicted before this subscriber's cursor
    // (parked at seq 2) ever reaches them.
    for (let i = 3; i < 20; i++) {
      await buffer.push("aaaaa");
    }

    const polled = sub.poll();

    // The exact count, not a loose bound: a mutant that replaces the real
    // arithmetic (`drops += oldestSeq - 1 - cursor`, ring-buffer.ts ~line
    // 87) with a constant, e.g. `drops += 1`, would report 1 here instead
    // of 11 — this assertion catches that, where `toBeGreaterThan(0)`
    // would not.
    expect(sub.drops).toBe(11);
    // And every surviving entry (seq 14..19, six of them) is returned in
    // full, exactly once — dropped (11) + survived (3 already consumed +
    // 6 just polled = 9) accounts for all 20 pushes minus double counting:
    // 11 dropped + 6 delivered-this-poll + 3 delivered-earlier === 20.
    expect(polled.length).toBe(6);
    expect(polled).toEqual(["aaaaa", "aaaaa", "aaaaa", "aaaaa", "aaaaa", "aaaaa"]);
  });

  it("a subscriber that polls every push never drops anything", async () => {
    const buffer = createRingBuffer(RING_CAPACITY_FOR_TEST);
    const sub = buffer.subscribe();
    for (let i = 0; i < 50; i++) {
      await buffer.push(`line-${String(i)}`);
      sub.poll();
    }
    expect(sub.drops).toBe(0);
  });

  it("close() makes a subscription stop returning data", async () => {
    const buffer = createRingBuffer();
    const sub = buffer.subscribe();
    sub.close();
    await buffer.push("after-close");
    expect(sub.poll()).toEqual([]);
  });
});

const RING_CAPACITY_FOR_TEST = 1024 * 1024;

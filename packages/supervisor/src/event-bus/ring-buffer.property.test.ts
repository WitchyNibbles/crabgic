/**
 * roadmap/05-supervisor-daemon.md §Test plan, Property (fast-check):
 * "randomized concurrent-subscriber sequences — a slow subscriber's drops
 * are always counted and never propagate backpressure to the worker
 * pipe." ≥1000 runs.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createRingBuffer } from "./ring-buffer.js";

// An "action" sequence: each element is either a push, or a poll on one of
// two subscribers (0 = fast, always-polled; 1 = slow, rarely polled).
type Action = { readonly kind: "push" } | { readonly kind: "poll"; readonly who: 0 | 1 };

// Weighted so subscriber 1 is genuinely "slow, rarely polled" (matching
// this arbitrary's own intent, previously undermined by an equal-weight
// fc.oneof that polled both subscribers at the same rate — which let
// subscriber 1 rarely fall more than one entry behind between polls,
// making a mutated drop count that happens to equal 1 hard to
// distinguish from the real exact count). Push is now the most likely
// action, subscriber 0 is polled often, subscriber 1 rarely — reliably
// producing multi-entry eviction gaps for subscriber 1 to expose an exact
// drop-count mismatch.
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 5, arbitrary: fc.constant<Action>({ kind: "push" }) },
  { weight: 3, arbitrary: fc.constant<Action>({ kind: "poll", who: 0 }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: "poll", who: 1 }) },
);

/**
 * Independent reference model for exact drop-count accounting —
 * maintained entirely by this test file's own separate simulation, never
 * by calling into ring-buffer.ts. It mirrors the documented byte-capacity
 * FIFO eviction rule (the only correct way to implement that part) but
 * computes each subscriber's drop count via a brute-force LOOP that counts
 * one missed seq at a time, never via ring-buffer.ts's own closed-form
 * subtraction (`drops += oldestSeq - 1 - cursor`, ring-buffer.ts ~line
 * 87). Because this model's code never touches the source file under
 * test, a mutant that fakes the real drop arithmetic (e.g. hardcoding
 * `drops += 1`) diverges from this independently-derived exact count —
 * even though it would still satisfy the weaker prior oracle
 * (`Number.isInteger(drops) && drops >= 0`).
 */
function createReferenceModel(capacityBytes: number, lineBytes: number) {
  const live: number[] = []; // live seqs, oldest first
  let totalBytes = 0;
  let nextSeq = 0;
  const cursors: [number, number] = [-1, -1];
  const drops: [number, number] = [0, 0];

  return {
    push(): void {
      live.push(nextSeq);
      nextSeq += 1;
      totalBytes += lineBytes;
      while (totalBytes > capacityBytes && live.length > 0) {
        live.shift();
        totalBytes -= lineBytes;
      }
    },
    poll(who: 0 | 1): void {
      const oldestSeq = live.length > 0 ? live[0]! : nextSeq;
      // Brute-force: count one missed seq at a time (a loop, never a
      // subtraction) for every seq strictly between this subscriber's own
      // cursor and the oldest still-live seq.
      let missed = 0;
      for (let seq = cursors[who] + 1; seq < oldestSeq; seq++) {
        missed += 1;
      }
      drops[who] += missed;
      if (missed > 0) cursors[who] = oldestSeq - 1;
      for (const seq of live) {
        if (seq > cursors[who]) cursors[who] = seq;
      }
    },
    dropsFor(who: 0 | 1): number {
      return drops[who];
    },
  };
}

describe("ring buffer — property: push() never blocks, drops are always accounted", () => {
  it("push() always resolves promptly, and each subscriber's exact drop count matches an independent reference model", async () => {
    // Deliberately tiny: holds only 5 entries (250/50). fast-check's
    // default size heuristic clusters generated array lengths well below
    // `maxLength` (empirically ~1-12 elements across 1000 runs even with
    // maxLength: 200 — verified directly), so a "small capacity" that
    // still assumed 40+ entries of headroom (the previous 2048/50 here)
    // rarely evicted anything in a typical run, leaving the exact-count
    // oracle below with almost nothing to check. `minLength: 60` (below)
    // is the other half of this fix — together they guarantee real,
    // repeated eviction in every run.
    const capacityBytes = 250;
    const lineBytes = 50; // Buffer.byteLength("x".repeat(50), "utf8")

    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 60, maxLength: 200 }), async (actions) => {
        const buffer = createRingBuffer(capacityBytes);
        const subs = [buffer.subscribe(), buffer.subscribe()] as const;
        const reference = createReferenceModel(capacityBytes, lineBytes);
        let pushCount = 0;
        let totalPushElapsedMs = 0;
        let totalPushed = 0;
        const survivedCount: [number, number] = [0, 0];

        for (const action of actions) {
          if (action.kind === "push") {
            const started = Date.now();
            await buffer.push("x".repeat(lineBytes));
            totalPushElapsedMs += Date.now() - started;
            pushCount += 1;
            totalPushed += 1;
            reference.push();
          } else {
            const polled = subs[action.who].poll();
            survivedCount[action.who] += polled.length;
            reference.poll(action.who);
          }
        }

        // Never blocks: averaged across the whole sequence, well under a
        // generous per-push bound. Averaging (rather than a strict
        // per-call cap) absorbs incidental OS-scheduler/GC jitter on a
        // shared/noisy host without weakening what this property actually
        // checks — genuine backpressure-induced blocking (the naive
        // PassThrough-stream stub this replaced) manifests as multi-
        // hundred-millisecond-to-unbounded stalls, not borderline
        // single-digit-millisecond noise, so this bound still cleanly
        // separates "correct" from "the naive stub."
        if (pushCount > 0 && totalPushElapsedMs / pushCount > 25) return false;

        // Final drain for both subscribers so "dropped + survived ===
        // pushed" is a meaningful, checkable invariant — mid-sequence it
        // can legitimately be less, since some pushed entries may still be
        // live but not yet polled by a given subscriber.
        for (const who of [0, 1] as const) {
          survivedCount[who] += subs[who].poll().length;
          reference.poll(who);
        }

        for (const who of [0, 1] as const) {
          // EXACT match against the independent reference model — not
          // just "a non-negative integer" (the prior, weaker oracle).
          if (subs[who].drops !== reference.dropsFor(who)) return false;
          // Full accounting: every push is either dropped or survived
          // (delivered to this subscriber via some poll()), never both,
          // never neither, once fully drained.
          if (subs[who].drops + survivedCount[who] !== totalPushed) return false;
        }

        return true;
      }),
      { numRuns: 1000 },
    );
  });

  it("a subscriber that never polls accumulates drops but never crashes or blocks the producer", async () => {
    const capacityBytes = 512; // tiny — guarantees eviction under load
    const lineBytes = 20;

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 500 }), async (pushCount) => {
        const buffer = createRingBuffer(capacityBytes);
        const neverPolled = buffer.subscribe();
        const reference = createReferenceModel(capacityBytes, lineBytes);
        for (let i = 0; i < pushCount; i++) {
          await buffer.push("y".repeat(lineBytes));
          reference.push();
        }
        // Never polled yet — drops is still 0 (nothing counted until poll()
        // is actually called, matching this module's own documented
        // "fast-forward on next poll" semantics), and poll() itself must
        // never throw.
        expect(neverPolled.drops).toBe(0);
        const polled = neverPolled.poll();
        reference.poll(0);
        expect(Array.isArray(polled)).toBe(true);
        // EXACT match against the independent reference model, not merely
        // "some array came back."
        expect(neverPolled.drops).toBe(reference.dropsFor(0));
        expect(neverPolled.drops + polled.length).toBe(pushCount);
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

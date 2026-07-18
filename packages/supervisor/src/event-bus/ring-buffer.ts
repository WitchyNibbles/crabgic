/**
 * Backpressured per-worker ring buffer — roadmap/05-supervisor-daemon.md
 * §Log streaming: "1 MiB ring buffer per worker; backpressured
 * subscribers — a slow consumer never blocks the worker's own pipe; drops
 * are counted, never silent."
 *
 * Design: `push()` is a pure, synchronous, O(1)-amortized append that
 * NEVER waits on any subscriber — the opposite of the naive PassThrough-
 * stream stub this replaces (see docs/evidence/phase-05/
 * wi5-ring-buffer-failing.txt), which awaited each subscriber's own
 * `drain` event and therefore genuinely stalled the producer behind the
 * slowest reader. Instead, every pushed line is appended to a byte-capacity-
 * bounded circular log; once the buffer exceeds `capacityBytes`, the
 * OLDEST entries are evicted regardless of whether any subscriber has read
 * them yet. Each subscriber is a PULL-based cursor over this same shared
 * log: `poll()` returns every entry newer than its own cursor. If a
 * subscriber's cursor has fallen behind the oldest entry still buffered
 * (i.e. entries were evicted before that subscriber ever polled them),
 * `poll()` fast-forwards the cursor to the oldest surviving entry and
 * increments that subscriber's own `drops` counter by exactly how many
 * entries it missed — counted, never silently discarded.
 */

export interface RingBufferSubscription {
  /** Every entry newer than this subscription's own cursor, oldest first. Advances the cursor. */
  poll(): readonly string[];
  /** Total entries this subscription has missed due to falling behind the buffer's eviction — monotonically non-decreasing. */
  readonly drops: number;
  close(): void;
}

export interface RingBuffer {
  /** Never blocks, regardless of subscriber state — always resolves once the append itself completes. */
  push(line: string): Promise<void>;
  subscribe(): RingBufferSubscription;
  /** Current buffered byte size (post-eviction). */
  readonly size: number;
}

export const RING_BUFFER_CAPACITY_BYTES = 1024 * 1024;

interface Entry {
  readonly seq: number;
  readonly bytes: number;
  readonly line: string;
}

export function createRingBuffer(capacityBytes: number = RING_BUFFER_CAPACITY_BYTES): RingBuffer {
  const entries: Entry[] = [];
  let totalBytes = 0;
  let nextSeq = 0;

  function evictToCapacity(): void {
    while (totalBytes > capacityBytes && entries.length > 0) {
      const evicted = entries.shift();
      if (evicted !== undefined) {
        totalBytes -= evicted.bytes;
      }
    }
  }

  return {
    async push(line: string): Promise<void> {
      const bytes = Buffer.byteLength(line, "utf8");
      entries.push({ seq: nextSeq, bytes, line });
      nextSeq += 1;
      totalBytes += bytes;
      evictToCapacity();
    },

    subscribe(): RingBufferSubscription {
      // Cursor semantics: "last seq this subscriber has already consumed."
      // Starts at -1 so the very first poll() sees every entry currently
      // buffered (matching a subscriber that connects after some history
      // already exists — it still gets whatever survived eviction, never
      // a throw).
      let cursor = -1;
      let drops = 0;
      let closed = false;

      return {
        poll(): readonly string[] {
          if (closed) return [];

          const oldestSeq = entries.length > 0 ? entries[0]!.seq : nextSeq;
          if (cursor < oldestSeq - 1) {
            drops += oldestSeq - 1 - cursor;
            cursor = oldestSeq - 1;
          }

          const fresh = entries.filter((e) => e.seq > cursor);
          if (fresh.length > 0) {
            cursor = fresh[fresh.length - 1]!.seq;
          }
          return fresh.map((e) => e.line);
        },
        get drops(): number {
          return drops;
        },
        close(): void {
          closed = true;
        },
      };
    },

    get size(): number {
      return totalBytes;
    },
  };
}

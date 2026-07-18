/**
 * SIGTERM -> grace -> SIGKILL termination ladder — roadmap/05-supervisor-
 * daemon.md §Worker management: "SIGTERM → grace → SIGKILL ladder." This
 * package has no raw OS process handle of its own (`WorkerHandle` carries
 * only `sessionRef`/`events` — 03's `EngineAdapter` interface, never a pid;
 * process-spawning internals are 03/06's, per roadmap/05 §Out of scope).
 * The ladder at THIS abstraction layer is therefore:
 *
 *   1. "SIGTERM" — ask the adapter to cancel, with a grace deadline
 *      (`EngineAdapter.cancel(handle, deadline)`; "the grace period an
 *      implementation has before it must force-terminate the underlying
 *      process," per `@eo/engine-core`'s own doc comment).
 *   2. "grace" — wait up to `graceMs` for the worker's own `events` stream
 *      to end on its own (a real adapter is expected to have force-killed
 *      the underlying process by its own `deadline`; this step is what
 *      observes whether it did).
 *   3. "SIGKILL" — if the stream hasn't ended by then, forcibly abandon
 *      the iterator (`iterator.return()`) and treat the worker as reaped
 *      regardless of what the adapter itself is still doing underneath —
 *      the strongest signal available at this layer, and exactly what
 *      lets a genuinely hung fake/real worker be reaped within a bounded
 *      deadline rather than staying stuck forever.
 */
import type { EngineAdapter, EngineEvent, WorkerHandle } from "@eo/engine-core";
import type { Timestamp } from "@eo/contracts";

export type TerminationOutcome = "graceful" | "forced";

export interface TerminationResult {
  readonly outcome: TerminationOutcome;
  readonly reapedAt: string;
}

export interface TerminateWorkerOptions {
  readonly adapter: EngineAdapter;
  readonly handle: WorkerHandle;
  /** The SAME iterator instance the caller has already been pulling `handle.events` from — never a fresh `[Symbol.asyncIterator]()` call, which would restart consumption from a point already past. */
  readonly iterator: AsyncIterator<EngineEvent>;
  readonly graceMs: number;
  readonly now?: () => Date;
}

/** Drains `iterator` until it reports `done` (normal completion OR a thrown error, both treated as "the stream ended"), or until `graceMs` elapses first. Returns whether it finished in time. */
async function drainUntilDoneOrTimeout(
  iterator: AsyncIterator<EngineEvent>,
  graceMs: number,
): Promise<boolean> {
  let finished = false;

  const drain = (async (): Promise<void> => {
    try {
      for (;;) {
        const { done } = await iterator.next();
        if (done) {
          finished = true;
          return;
        }
      }
    } catch {
      // A thrown iterator (an adapter surfacing a crash as a rejected
      // `.next()`) is also "the stream ended" for termination purposes —
      // crash *detection* itself is a different module's concern
      // (`./crash-detection.ts`), not this ladder's.
      finished = true;
    }
  })();

  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, graceMs);
    timer.unref?.();
  });

  await Promise.race([drain, timeout]);
  return finished;
}

export async function terminateWorker(options: TerminateWorkerOptions): Promise<TerminationResult> {
  const nowFn = options.now ?? ((): Date => new Date());
  const deadline = new Date(nowFn().getTime() + options.graceMs).toISOString() as Timestamp;

  // Step 1 — "SIGTERM": ask nicely, with a grace deadline.
  await options.adapter.cancel(options.handle, deadline);

  // Step 2 — "grace": observe whether the stream ends on its own in time.
  const finishedInTime = await drainUntilDoneOrTimeout(options.iterator, options.graceMs);
  if (finishedInTime) {
    return { outcome: "graceful", reapedAt: nowFn().toISOString() };
  }

  // Step 3 — "SIGKILL": give up waiting on this worker from OUR side —
  // this is what makes the ladder resilient even to an adapter whose
  // `cancel()` fails to honor its own contract. `iterator.return()` is
  // requested as a best-effort cleanup signal but DELIBERATELY NOT
  // awaited: an async generator's `return()` can only take effect at its
  // NEXT yield point or once its current pending `await` settles — if the
  // underlying implementation is truly wedged on an `await` that will
  // never resolve (the exact pathological case this step exists to
  // survive), awaiting `return()` itself would hang forever, defeating the
  // whole point of a bounded termination ladder. The caller's own
  // registries are updated to `crashed`/`terminated` based on THIS
  // function's return value, independent of whether the generator itself
  // ever actually completes underneath.
  options.iterator.return?.(undefined)?.catch(() => {
    // Best-effort only — a rejected return() is not this function's problem.
  });
  return { outcome: "forced", reapedAt: nowFn().toISOString() };
}

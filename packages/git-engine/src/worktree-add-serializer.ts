/**
 * Per-repository serialization of `git worktree add`.
 *
 * WHY (2026-07-30). Two facts meet here. Git promises nothing about running
 * `worktree add` concurrently against one repository — `add` enumerates
 * `.git/worktrees/*` and reads each entry's `commondir`, which a concurrent
 * `add` is in the middle of creating. And this repository's scheduler runs up
 * to four attempts per round through `Promise.all` (`@crabgic/scheduler`'s
 * `run-driver.ts`, cap 4), each of which cuts its own worktree from the same
 * control clone. So the unguaranteed thing is a thing production does.
 *
 * The observed symptom was
 * `fatal: failed to read .git/worktrees/<other-attempt>/commondir: Success`
 * out of a 12-way concurrent create — note the errno string, which is git
 * reporting a failed read with `errno` unset. It was written off as a
 * host-load-flaky test for weeks. I could not reproduce it on demand (400
 * concurrent raw `worktree add` calls under CPU contention, zero failures), so
 * this is NOT a fix aimed at a diagnosis I confirmed; it removes the whole
 * class by not relying on a guarantee git does not give.
 *
 * Serialization is per `repoDir`, so unrelated repositories never wait on each
 * other, and the cost is bounded: `worktree add` is tens to low hundreds of
 * milliseconds, incurred once per attempt, against a fan-out cap of four.
 *
 * In-process is the right scope. The supervisor daemon is single-writer per
 * project (its own lease enforces that), so every concurrent create in a real
 * deployment originates in one process. A second daemon cannot exist to race
 * this one.
 */

/** The tail promise per repository. A queue, not a lock: FIFO, and never blocked by a previous failure. */
const tails = new Map<string, Promise<unknown>>();

/**
 * Runs `task` after every previously-submitted task for the same `repoDir` has
 * settled — success or failure. A rejection reaches only its own caller; it
 * never poisons the queue or leaves an unhandled rejection behind.
 */
export async function serializeWorktreeAdd<T>(repoDir: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(repoDir) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);

  // The tail must never reject, or the NEXT caller's `.catch` would be the
  // only thing standing between a failure here and an unhandled rejection
  // warning. Track a settle-only sibling as the tail; return the real result.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(repoDir, tail);
  try {
    return await run;
  } finally {
    // Drop the entry once this is the last queued task, so a long-lived daemon
    // does not accumulate one promise per repository it has ever touched.
    if (tails.get(repoDir) === tail) tails.delete(repoDir);
  }
}

/**
 * Per-tenant+resource write serialization — roadmap/16-gateway-core.md §In
 * scope, "Transport security": "write serialization per tenant+resource."
 * Work item 2. Ensures writes targeting the SAME `(tenant, resource)` key
 * execute strictly in submission order, one at a time, while writes for
 * DIFFERENT keys run fully concurrently — never a single global lock.
 */

export interface WriteSerializerKey {
  readonly tenant: string;
  readonly resource: string;
}

/**
 * Joins the two fields with a control character that cannot occur in
 * either, so a sliding field boundary cannot collapse two different keys
 * onto one queue — pinned behaviourally by the sliding-boundary case in
 * `./write-serializer.test.ts`.
 *
 * WRITTEN AS THE ESCAPE `\\0`, NEVER AS A RAW 0x00 BYTE IN THIS SOURCE.
 * Identical at runtime (both are U+0000), but a raw NUL makes git
 * classify this file as BINARY: `git diff` then refuses to show the
 * change and reviewers see `Bin 1973 -> 5815 bytes` instead of a diff.
 * `scripts/check-repo-hygiene.mjs` fails the build on a raw NUL in any
 * tracked text source, so reverting this is caught rather than merged.
 */
function keyOf(key: WriteSerializerKey): string {
  return `${key.tenant}\0${key.resource}`;
}

/**
 * A per-key FIFO write queue. `runExclusive` chains onto the tail promise
 * for that key — the caller's task never starts before every
 * previously-submitted task for the SAME key has settled (success or
 * failure), and a failure never blocks a later task from running (the
 * chain link swallows the previous rejection before extending).
 *
 * `runExclusiveMulti` generalizes this to a SET of keys taken at once,
 * which is what roadmap/18 exit criterion 10's `bulk:<keys>` residual
 * needs: a bulk write to PROJ-1 and PROJ-2 must take both issues' mutexes
 * so it serializes against a single-issue write to either one. See its
 * own doc comment for the deadlock-freedom reasoning.
 */
export class WriteSerializer {
  readonly #tails = new Map<string, Promise<unknown>>();

  /**
   * Single-key acquisition. Deliberately a thin delegation to
   * `runExclusiveMulti` rather than a second, parallel chain
   * implementation: two implementations of the same promise-chain
   * protocol would absorb each other's test coverage (a deletion in one
   * leaves the other's suites green), so there is exactly ONE chain here
   * and every existing single-key case pins it.
   */
  async runExclusive<T>(key: WriteSerializerKey, task: () => Promise<T>): Promise<T> {
    return this.runExclusiveMulti([key], task);
  }

  /**
   * Multi-key FIFO acquisition — the task starts only after every
   * previously-submitted task for EVERY named key has settled (success
   * or failure), and it becomes the new tail of every one of those
   * keys' queues. A failure never blocks a later task on any of them.
   *
   * DEADLOCK-FREEDOM — two independent properties, and the distinction
   * matters, so do not collapse it into "sorting makes it deadlock-free":
   *
   *  (1) ATOMIC REGISTRATION is what actually provides it HERE.
   *      Everything from reading the previous tails to installing the new
   *      tail below is synchronous — there is no `await` in this method's
   *      body — so two concurrent acquisitions can never each observe a
   *      partial view of the other. The waits-on relation therefore
   *      follows registration order, which is a total order (the
   *      synchronous sections of two calls cannot interleave in
   *      single-threaded JS), so no cycle can form regardless of key
   *      order. Adding an `await` anywhere between the `#tails.get` reads
   *      and the `#tails.set` writes would destroy this property.
   *
   *  (2) The SORTED, DEDUPED key set is the classical lock-ordering
   *      invariant. Given (1) it is not load-bearing for correctness
   *      today; it is kept deliberately so the guarantee survives any
   *      future refactor to INCREMENTAL acquisition (acquire k1, await,
   *      acquire k2 — where an unsorted order genuinely deadlocks: A
   *      takes K1 then K2 while B takes K2 then K1), and so the tail
   *      map's state is deterministic and a duplicate key cannot make a
   *      task wait on itself.
   *
   * The pin for this paragraph is BEHAVIORAL, not structural: the
   * reversed-order case in `./write-serializer.test.ts` submits `[A,B]`
   * and `[B,A]` and awaits both — any design that can deadlock times the
   * suite out. It is deliberately agnostic about WHICH of (1)/(2)
   * supplies the property.
   *
   * Interplay with `../transport/http-client.js`'s `ConcurrencyGate`: the
   * gate is acquired BEFORE registration, so every registered waiter
   * already holds a gate slot and the earliest-registered unfinished task
   * always runs — progress is guaranteed. Do not reorder gate and
   * serializer.
   */
  async runExclusiveMulti<T>(
    keys: readonly WriteSerializerKey[],
    task: () => Promise<T>,
  ): Promise<T> {
    const distinct = [...new Set(keys.map(keyOf))].sort();
    // No key named at all ⇒ nothing to serialize against. Callers that
    // mean "serialize this write" must name at least one key; the
    // mutation pipeline never reaches here with an empty set (it falls
    // back to `plan.canonicalTarget`), so this is a defensive floor.
    if (distinct.length === 0) return task();

    const previousTails = distinct.map((k) => this.#tails.get(k) ?? Promise.resolve());

    // Never let a previous failure propagate into blocking the next task.
    const settledPrevious = Promise.all(previousTails.map((p) => p.catch(() => undefined)));
    const runPromise = settledPrevious.then(task);

    // The new tail must itself never reject (so the NEXT caller's chain
    // doesn't see an unhandled rejection warning) — track a settle-only
    // sibling as the tail while returning the real result/rejection to
    // THIS caller. The SAME sibling becomes the tail of every named key,
    // which is what makes a later single-key acquisition on any member
    // wait for this whole multi-key task.
    //
    // The sibling ALSO unregisters its own keys, and that is what bounds
    // `#tails`. Without it the map is append-only for the life of the process:
    // `../mutation-pipeline/mutation-pipeline.js`'s `IdempotencyKeyLock` wraps
    // ONE `WriteSerializer` per gateway process, keyed on
    // `plan.idempotencyKey`, and those keys embed `Date.now()`, so they never
    // repeat — one dead entry per mutation, forever.
    //
    // The `=== tailSibling` identity test is the whole correctness argument
    // and must not be reduced to a bare `delete`: a task that queued behind
    // this one has already overwritten the tail, and deleting THAT would let a
    // third acquisition mint a fresh queue and run concurrently with it. The
    // test is exact because a later caller's `get`/`set` pair is synchronous,
    // so this handler can never observe it half-done.
    const releaseTails = (): void => {
      for (const k of distinct) {
        if (this.#tails.get(k) === tailSibling) this.#tails.delete(k);
      }
    };
    const tailSibling: Promise<void> = runPromise.then(releaseTails, releaseTails);
    for (const k of distinct) this.#tails.set(k, tailSibling);

    return runPromise;
  }

  /** Number of distinct `(tenant, resource)` keys with in-flight or queued work — test/observability helper. */
  get activeKeyCount(): number {
    return this.#tails.size;
  }
}

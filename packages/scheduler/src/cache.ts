/**
 * Content-hash + toolchain-fingerprint keyed cache — roadmap/13-scheduler-
 * packets-context.md §In scope, "Caches": "content-hash keyed (stack
 * profiles, doc research, provider capabilities, verified results), salted
 * by toolchain fingerprint." §Test plan: "cache-key derivation (content-
 * hash + toolchain fingerprint) equality/inequality vectors"; Property:
 * "random content/fingerprint pairs — cache hit iff both match exactly, no
 * partial-match false positive." §In scope also: "Shadow-run attempts...
 * bypass this cache on both read and write" — see `bypass` below and
 * `./shadow-run.ts`, which never references this module at all (the
 * strongest form of "bypass": no call site exists to bypass).
 */

export interface CacheKey {
  readonly contentHash: string;
  readonly toolchainFingerprint: string;
}

/**
 * Composite key string — BOTH fields must match exactly for a lookup to
 * ever resolve to the same map entry. This is what makes cache-poisoning
 * resistance hold by construction: an entry keyed to
 * `(hashA, fingerprintA)` is structurally a DIFFERENT map key than
 * `(hashA, fingerprintB)`.
 *
 * MINOR-2 fix (adversarial-validation round): a plain `${a}::${b}` join is
 * AMBIGUOUS whenever either field can itself contain the separator —
 * `(contentHash: "a", toolchainFingerprint: "b::c")` and
 * `(contentHash: "a::b", toolchainFingerprint: "c")` both collapsed to the
 * identical string `"a::b::c"`, producing a proven cross-fingerprint HIT
 * (reproduced in `cache.test.ts`'s own regression). `JSON.stringify` of the
 * 2-tuple is used instead: JSON string encoding always escapes embedded
 * quote/backslash/control characters, so the two-element array's own
 * `["...", "..."]` structural delimiters (the comma between the two quoted
 * elements) can NEVER be produced by the CONTENT of an escaped string —
 * only by the array structure itself — which makes this composition
 * unambiguous for arbitrary string content, not merely "safe in practice
 * because both fields happen to be hex digests."
 */
export function cacheKeyString(key: CacheKey): string {
  return JSON.stringify([key.contentHash, key.toolchainFingerprint]);
}

export interface CacheEntry<T> {
  readonly key: CacheKey;
  readonly value: T;
}

/**
 * A simple in-memory `SchedulerCache<T>` — no eviction policy is pinned by
 * any cited source material (this phase's own minimal-sufficient choice);
 * persistence/eviction is a carry-forward concern for whichever later
 * phase wires this into a long-lived supervisor process.
 */
export class SchedulerCache<T> {
  readonly #store = new Map<string, CacheEntry<T>>();

  /** `undefined` unless BOTH `contentHash` and `toolchainFingerprint` match an existing entry exactly. */
  get(key: CacheKey): T | undefined {
    return this.#store.get(cacheKeyString(key))?.value;
  }

  set(key: CacheKey, value: T): void {
    this.#store.set(cacheKeyString(key), { key, value });
  }

  has(key: CacheKey): boolean {
    return this.#store.has(cacheKeyString(key));
  }

  get size(): number {
    return this.#store.size;
  }
}

export interface GetOrComputeOptions<T> {
  readonly cache: SchedulerCache<T>;
  readonly key: CacheKey;
  readonly compute: () => Promise<T> | T;
  /**
   * Shadow-run cache bypass (roadmap/13 §In scope: "Shadow-run attempts...
   * bypass this cache on both read and write"). When `true`, `compute()`
   * always runs fresh and its result is NEVER written back — the cache is
   * untouched on both the read and the write side, matching the phase
   * text's exact wording. Default `false`.
   */
  readonly bypass?: boolean;
}

export interface GetOrComputeResult<T> {
  readonly value: T;
  readonly source: "hit" | "cold" | "bypass";
}

/**
 * `get`-then-`compute`-then-`set` convenience wrapper. With `bypass: true`
 * this NEVER reads the cache (always computes) and NEVER writes the
 * result back — the two halves of "bypass this cache on both read and
 * write."  The `"hit"` path returns the cached value completely unchanged
 * (byte-identical) — exit criterion: "Cache hit path byte-identical to
 * cold path" (the SAME `compute()` result is what a cold path would have
 * produced and stored; a hit merely skips re-running `compute()`).
 */
export async function getOrCompute<T>(
  options: GetOrComputeOptions<T>,
): Promise<GetOrComputeResult<T>> {
  if (options.bypass === true) {
    return { value: await options.compute(), source: "bypass" };
  }

  const cached = options.cache.get(options.key);
  if (cached !== undefined) {
    return { value: cached, source: "hit" };
  }

  const computed = await options.compute();
  options.cache.set(options.key, computed);
  return { value: computed, source: "cold" };
}

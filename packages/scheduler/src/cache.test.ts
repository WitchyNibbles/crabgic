import { describe, expect, it, vi } from "vitest";
import { cacheKeyString, getOrCompute, SchedulerCache } from "./cache.js";

describe("SchedulerCache", () => {
  it("misses when nothing has been set", () => {
    const cache = new SchedulerCache<string>();
    expect(cache.get({ contentHash: "h1", toolchainFingerprint: "f1" })).toBeUndefined();
    expect(cache.has({ contentHash: "h1", toolchainFingerprint: "f1" })).toBe(false);
  });

  it("hits on an exact (contentHash, toolchainFingerprint) match", () => {
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "h1", toolchainFingerprint: "f1" }, "value-1");
    expect(cache.get({ contentHash: "h1", toolchainFingerprint: "f1" })).toBe("value-1");
    expect(cache.size).toBe(1);
  });

  it("MISSES on a fingerprint mismatch even when contentHash matches (poisoning resistance)", () => {
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "h1", toolchainFingerprint: "f1" }, "value-1");
    expect(cache.get({ contentHash: "h1", toolchainFingerprint: "f2" })).toBeUndefined();
  });

  it("MISSES on a contentHash mismatch even when fingerprint matches", () => {
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "h1", toolchainFingerprint: "f1" }, "value-1");
    expect(cache.get({ contentHash: "h2", toolchainFingerprint: "f1" })).toBeUndefined();
  });

  it("MINOR-2 regression: a boundary-shifted (contentHash, toolchainFingerprint) pair must NEVER collide with a different pair (proves the composite key is unambiguous)", () => {
    // (hash="a", fp="b::c") and (hash="a::b", fp="c") are DIFFERENT pairs,
    // but a naive `${hash}::${fp}` join collapses both to the identical
    // string "a::b::c" — a plain `::`-separator join is ambiguous whenever
    // either field can itself contain "::". This must never produce a
    // cross-fingerprint HIT.
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "a", toolchainFingerprint: "b::c" }, "value-for-b-colon-colon-c-fp");

    const crossPairResult = cache.get({ contentHash: "a::b", toolchainFingerprint: "c" });
    expect(crossPairResult).toBeUndefined();

    // The genuinely-matching pair still hits correctly.
    expect(cache.get({ contentHash: "a", toolchainFingerprint: "b::c" })).toBe(
      "value-for-b-colon-colon-c-fp",
    );
  });

  it("an entry keyed to one fingerprint is never served to a different declared fingerprint, even after many writes", () => {
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "same-hash", toolchainFingerprint: "node-24" }, "node-24-result");
    cache.set({ contentHash: "same-hash", toolchainFingerprint: "node-22" }, "node-22-result");
    expect(cache.get({ contentHash: "same-hash", toolchainFingerprint: "node-24" })).toBe(
      "node-24-result",
    );
    expect(cache.get({ contentHash: "same-hash", toolchainFingerprint: "node-22" })).toBe(
      "node-22-result",
    );
  });
});

describe("cacheKeyString", () => {
  it("is a deterministic, distinct string per (contentHash, toolchainFingerprint) pair", () => {
    expect(cacheKeyString({ contentHash: "a", toolchainFingerprint: "b" })).toBe('["a","b"]');
    expect(cacheKeyString({ contentHash: "a", toolchainFingerprint: "b" })).not.toBe(
      cacheKeyString({ contentHash: "ab", toolchainFingerprint: "" }),
    );
  });

  it("MINOR-2 fix: is unambiguous even when a field contains characters that made the old ':: '-join separator collide", () => {
    expect(cacheKeyString({ contentHash: "a", toolchainFingerprint: "b::c" })).not.toBe(
      cacheKeyString({ contentHash: "a::b", toolchainFingerprint: "c" }),
    );
  });
});

describe("getOrCompute", () => {
  it("computes and stores on a cold miss", async () => {
    const cache = new SchedulerCache<string>();
    const compute = vi.fn().mockResolvedValue("computed-value");
    const result = await getOrCompute({
      cache,
      key: { contentHash: "h1", toolchainFingerprint: "f1" },
      compute,
    });
    expect(result).toEqual({ value: "computed-value", source: "cold" });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cache.get({ contentHash: "h1", toolchainFingerprint: "f1" })).toBe("computed-value");
  });

  it("returns the cached value byte-identical on a hit, without recomputing", async () => {
    const cache = new SchedulerCache<string>();
    const compute = vi.fn().mockResolvedValue("computed-value");
    const first = await getOrCompute({
      cache,
      key: { contentHash: "h1", toolchainFingerprint: "f1" },
      compute,
    });
    const second = await getOrCompute({
      cache,
      key: { contentHash: "h1", toolchainFingerprint: "f1" },
      compute,
    });
    expect(second.source).toBe("hit");
    // Exit criterion: "Cache hit path byte-identical to cold path."
    expect(second.value).toBe(first.value);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("bypass:true never reads AND never writes the cache", async () => {
    const cache = new SchedulerCache<string>();
    cache.set({ contentHash: "h1", toolchainFingerprint: "f1" }, "pre-existing");
    const compute = vi.fn().mockResolvedValue("shadow-computed");

    const result = await getOrCompute({
      cache,
      key: { contentHash: "h1", toolchainFingerprint: "f1" },
      compute,
      bypass: true,
    });

    expect(result).toEqual({ value: "shadow-computed", source: "bypass" });
    expect(compute).toHaveBeenCalledTimes(1);
    // The cache is completely untouched: the pre-existing entry survives
    // unmodified, and the bypassed compute() result was never written.
    expect(cache.get({ contentHash: "h1", toolchainFingerprint: "f1" })).toBe("pre-existing");
    expect(cache.size).toBe(1);
  });
});

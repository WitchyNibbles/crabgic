import { describe, expect, it } from "vitest";
import {
  canonicalize,
  computeEntryHash,
  GENESIS_PREV_HASH,
  omitHashField,
  sha256Hex,
} from "./hash-chain.js";

describe("hash-chain", () => {
  it("GENESIS_PREV_HASH is 64 lowercase hex zero characters", () => {
    expect(GENESIS_PREV_HASH).toBe("0".repeat(64));
    expect(GENESIS_PREV_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonicalize sorts object keys ascending regardless of insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it("canonicalize sorts nested object keys too", () => {
    expect(canonicalize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("canonicalize preserves array element order", () => {
    expect(canonicalize({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it("canonicalize omits undefined-valued keys, matching JSON.stringify's default", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ a: 1 })).toBe(canonicalize({ a: 1, b: undefined }));
  });

  it("canonicalize renders a top-level or array-nested null/undefined as the literal null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(undefined)).toBe("null");
    expect(canonicalize([undefined, null, 1])).toBe("[null,null,1]");
  });

  it("canonicalize rejects non-finite numbers (NaN, Infinity)", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });

  it("canonicalize rejects unsupported value types (functions, symbols)", () => {
    expect(() => canonicalize(() => {})).toThrow(TypeError);
    expect(() => canonicalize(Symbol("x"))).toThrow(TypeError);
  });

  it("sha256Hex is deterministic and matches a known vector", () => {
    // echo -n "" | sha256sum
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("")).toHaveLength(64);
  });

  it("omitHashField strips only the hash key", () => {
    const copy = omitHashField({ a: 1, hash: "deadbeef" });
    expect(copy).toEqual({ a: 1 });
    expect(Object.keys(copy)).not.toContain("hash");
  });

  it("computeEntryHash is stable for the same logical entry regardless of key order", () => {
    const h1 = computeEntryHash({ seq: 1, type: "x", hash: "ignored" });
    const h2 = computeEntryHash({ hash: "different-ignored", type: "x", seq: 1 });
    expect(h1).toBe(h2);
  });

  it("computeEntryHash changes when any non-hash field changes", () => {
    const h1 = computeEntryHash({ seq: 1, type: "x" });
    const h2 = computeEntryHash({ seq: 2, type: "x" });
    expect(h1).not.toBe(h2);
  });
});

import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalStringify } from "./canonical-hash.js";

describe("canonicalStringify / canonicalHash", () => {
  it("key order does not affect the hash", () => {
    const a = { metric: "latency", threshold: 200, unit: "ms" };
    const b = { unit: "ms", threshold: 200, metric: "latency" };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("a changed field value changes the hash", () => {
    const a = canonicalHash({ metric: "cpu_time", threshold: 10, unit: "s" });
    const b = canonicalHash({ metric: "cpu_time", threshold: 20, unit: "s" });
    expect(a).not.toBe(b);
  });

  it("array element order IS significant (never normalized)", () => {
    const a = canonicalStringify([{ x: 1 }, { x: 2 }]);
    const b = canonicalStringify([{ x: 2 }, { x: 1 }]);
    expect(a).not.toBe(b);
  });

  it("the hash is sha256:-prefixed hex", () => {
    expect(canonicalHash([])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("undefined-valued keys are omitted, matching JSON.stringify semantics", () => {
    const a = canonicalStringify({ a: 1, b: undefined });
    const b = canonicalStringify({ a: 1 });
    expect(a).toBe(b);
  });
});

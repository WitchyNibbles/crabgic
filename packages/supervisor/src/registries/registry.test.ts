import { describe, expect, it } from "vitest";
import { createInMemoryRegistry } from "./registry.js";

interface Widget {
  readonly id: string;
  readonly label: string;
}

describe("createInMemoryRegistry", () => {
  it("list() on a freshly-created, empty registry returns [], never throws", () => {
    const registry = createInMemoryRegistry<Widget>();
    expect(registry.list()).toEqual([]);
  });

  it("query() on an empty registry returns [], never throws", () => {
    const registry = createInMemoryRegistry<Widget>();
    expect(registry.query(() => true)).toEqual([]);
  });

  it("get() on an empty registry returns undefined, never throws", () => {
    const registry = createInMemoryRegistry<Widget>();
    expect(registry.get("missing")).toBeUndefined();
  });

  it("put() then get()/list() round-trips the item", () => {
    const registry = createInMemoryRegistry<Widget>();
    registry.put({ id: "w1", label: "one" });
    expect(registry.get("w1")).toEqual({ id: "w1", label: "one" });
    expect(registry.list()).toEqual([{ id: "w1", label: "one" }]);
  });

  it("put() with an existing id overwrites (immutable replace, never a partial mutation)", () => {
    const registry = createInMemoryRegistry<Widget>();
    registry.put({ id: "w1", label: "one" });
    registry.put({ id: "w1", label: "two" });
    expect(registry.list()).toEqual([{ id: "w1", label: "two" }]);
  });

  it("query() filters by predicate", () => {
    const registry = createInMemoryRegistry<Widget>();
    registry.put({ id: "w1", label: "keep" });
    registry.put({ id: "w2", label: "drop" });
    expect(registry.query((w) => w.label === "keep")).toEqual([{ id: "w1", label: "keep" }]);
  });
});

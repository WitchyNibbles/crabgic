import { describe, expect, it } from "vitest";
import { GrafanaPlanPayloadStore } from "./plan-payload-store.js";

describe("GrafanaPlanPayloadStore", () => {
  it("sets and retrieves a payload by plan id", () => {
    const store = new GrafanaPlanPayloadStore();
    store.set("plan-1", { kind: "folder", action: "create", input: { title: "x" } });
    expect(store.get("plan-1")).toEqual({
      kind: "folder",
      action: "create",
      input: { title: "x" },
    });
  });

  it("returns undefined for an unset plan id", () => {
    const store = new GrafanaPlanPayloadStore();
    expect(store.get("nope")).toBeUndefined();
  });

  it("clear removes a stored payload", () => {
    const store = new GrafanaPlanPayloadStore();
    store.set("plan-1", { kind: "folder", action: "create", input: {} });
    store.clear("plan-1");
    expect(store.get("plan-1")).toBeUndefined();
  });
});

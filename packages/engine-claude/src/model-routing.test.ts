import { describe, expect, it } from "vitest";
import { DEFAULT_WORKER_MODEL, resolveWorkerModel } from "./model-routing.js";

/**
 * `model-routing` (roadmap/06-claude-engine-adapter.md §In scope, "Spawn
 * path": "model routed per role (balanced defaults, overrides only via
 * approved envelope)"; adaptation §0's balanced-default decision). Per-role
 * routing itself is phase 13's job — this module only supplies the
 * balanced default and the override-application function.
 */
describe("DEFAULT_WORKER_MODEL", () => {
  it("is the balanced default model (adaptation §0)", () => {
    expect(DEFAULT_WORKER_MODEL).toBe("sonnet");
  });
});

describe("resolveWorkerModel", () => {
  it("returns the balanced default when no model is supplied", () => {
    expect(resolveWorkerModel(undefined)).toBe(DEFAULT_WORKER_MODEL);
  });

  it("returns the balanced default when called with no arguments", () => {
    expect(resolveWorkerModel()).toBe(DEFAULT_WORKER_MODEL);
  });

  it("passes through an explicit override verbatim", () => {
    expect(resolveWorkerModel("opus")).toBe("opus");
  });

  it("passes through an arbitrary explicit model string verbatim (13's own routing decision)", () => {
    expect(resolveWorkerModel("claude-opus-4-8")).toBe("claude-opus-4-8");
  });
});

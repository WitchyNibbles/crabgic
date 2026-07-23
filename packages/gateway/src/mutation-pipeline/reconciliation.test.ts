import { describe, expect, it } from "vitest";
import {
  AmbiguousWriteBlockedError,
  assertReconciled,
  reconcileAmbiguousPost,
  type MarkerReconciler,
} from "./reconciliation.js";

describe("reconcileAmbiguousPost", () => {
  it("returns reconciled when the marker is found", async () => {
    const reconciler: MarkerReconciler = { findByMarker: async () => "issue:EX-42" };
    const outcome = await reconcileAmbiguousPost(reconciler, "marker-abc");
    expect(outcome).toEqual({ kind: "reconciled", canonicalTarget: "issue:EX-42" });
  });

  it("returns blocked when the marker is not found", async () => {
    const reconciler: MarkerReconciler = { findByMarker: async () => undefined };
    const outcome = await reconcileAmbiguousPost(reconciler, "marker-abc");
    expect(outcome.kind).toBe("blocked");
  });
});

describe("assertReconciled", () => {
  it("does not throw for a reconciled outcome", () => {
    expect(() =>
      assertReconciled({ kind: "reconciled", canonicalTarget: "issue:EX-1" }),
    ).not.toThrow();
  });

  it("throws AmbiguousWriteBlockedError for a blocked outcome", () => {
    expect(() => assertReconciled({ kind: "blocked", reason: "not found" })).toThrow(
      AmbiguousWriteBlockedError,
    );
  });
});

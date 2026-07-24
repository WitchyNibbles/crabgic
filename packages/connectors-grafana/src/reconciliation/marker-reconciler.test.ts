import { describe, expect, it } from "vitest";
import {
  createGrafanaMarkerReconciler,
  deriveAnnotationMarkerTag,
  deriveDeterministicUid,
} from "./marker-reconciler.js";

describe("deriveDeterministicUid / deriveAnnotationMarkerTag", () => {
  it("is a pure, deterministic function of the idempotency key alone", () => {
    const a = deriveDeterministicUid("op-1");
    const b = deriveDeterministicUid("op-1");
    const c = deriveDeterministicUid("op-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("annotation marker tags are prefixed and derived from the same uid", () => {
    const tag = deriveAnnotationMarkerTag("op-1");
    expect(tag).toBe(`eo-marker:${deriveDeterministicUid("op-1")}`);
  });
});

describe("createGrafanaMarkerReconciler — uid-addressable kinds (folder/dashboard/alert-rule/contact-point/mute-timing/notification-template)", () => {
  it("finds an object whose uid already exists remotely", async () => {
    const reconciler = createGrafanaMarkerReconciler({
      kind: "folder",
      getByUid: async (uid) => ({ found: uid === "found-uid" }),
    });
    await expect(reconciler.findByMarker("found-uid")).resolves.toBe("found-uid");
  });

  it("never guesses — a genuinely absent uid resolves to undefined, never a fabricated match", async () => {
    const reconciler = createGrafanaMarkerReconciler({
      kind: "folder",
      getByUid: async () => ({ found: false }),
    });
    await expect(reconciler.findByMarker("missing-uid")).resolves.toBeUndefined();
  });

  it("resolves undefined when no getByUid lookup was wired at all (fails closed, never throws)", async () => {
    const reconciler = createGrafanaMarkerReconciler({ kind: "contact-point" });
    await expect(reconciler.findByMarker("any-uid")).resolves.toBeUndefined();
  });
});

describe("createGrafanaMarkerReconciler — annotation (tag-based marker)", () => {
  it("finds the annotation's own externalId by tag, distinct from the tag itself", async () => {
    const reconciler = createGrafanaMarkerReconciler({
      kind: "annotation",
      findByTag: async (tag) => (tag === "eo-marker:abc" ? "42" : undefined),
    });
    await expect(reconciler.findByMarker("eo-marker:abc")).resolves.toBe("42");
  });

  it("never guesses for annotations either", async () => {
    const reconciler = createGrafanaMarkerReconciler({
      kind: "annotation",
      findByTag: async () => undefined,
    });
    await expect(reconciler.findByMarker("eo-marker:missing")).resolves.toBeUndefined();
  });
});

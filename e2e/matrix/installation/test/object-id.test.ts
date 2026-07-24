import { describe, expect, it } from "vitest";
import { buildCleanRepo } from "../src/fixtures.js";
import { resolveHeadObjectId, syntheticObjectId } from "../src/scenarios/object-id.js";

describe("object-id resolution", () => {
  it("resolveHeadObjectId returns the real 40-hex-char HEAD commit id of a real repo", async () => {
    const fixture = await buildCleanRepo();
    try {
      const objectId = await resolveHeadObjectId(fixture.dir);
      expect(objectId).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await fixture.cleanup();
    }
  });

  it("syntheticObjectId is deterministic, labeled, and never collides across distinct labels", () => {
    const a = syntheticObjectId("installation-matrix/empty-dir");
    const b = syntheticObjectId("installation-matrix/empty-dir");
    const c = syntheticObjectId("installation-matrix/unborn-head");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("synthetic:")).toBe(true);
  });
});

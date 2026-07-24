import { describe, expect, it } from "vitest";
import { RELEASE_GATE_CHECKLIST } from "./checklist.js";

describe("RELEASE_GATE_CHECKLIST — models roadmap/23's 15 Exit-criteria items", () => {
  it("has exactly 15 items", () => {
    expect(RELEASE_GATE_CHECKLIST).toHaveLength(15);
  });

  it("every item id is unique", () => {
    const ids = RELEASE_GATE_CHECKLIST.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every item is required (roadmap/23 lists all 15 as unconditional release blockers)", () => {
    for (const item of RELEASE_GATE_CHECKLIST) {
      expect(item.required).toBe(true);
    }
  });

  it("every item declares >=1 non-empty requiredGateTags entry", () => {
    for (const item of RELEASE_GATE_CHECKLIST) {
      expect(item.requiredGateTags.length).toBeGreaterThanOrEqual(1);
      for (const tag of item.requiredGateTags) {
        expect(tag.length).toBeGreaterThan(0);
      }
    }
  });

  it("every item has a non-empty description", () => {
    for (const item of RELEASE_GATE_CHECKLIST) {
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it("every dedicated release-gate tag is unique across items (no two items share their own namespaced tag)", () => {
    const ownTags = RELEASE_GATE_CHECKLIST.map((item) =>
      item.requiredGateTags.find((t) => t.startsWith("release-gate:"))!,
    );
    expect(ownTags.every((t) => t !== undefined)).toBe(true);
    expect(new Set(ownTags).size).toBe(ownTags.length);
  });
});

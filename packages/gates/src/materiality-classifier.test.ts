import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMaterialAmendmentSignal, classifyMateriality } from "./materiality-classifier.js";

/**
 * roadmap/21 work item 4: "a diff touching only a non-tracked field (e.g.
 * Jira watchers) must NOT trigger, asserted before the tracked-field-
 * triggers case is implemented" — the failing-first case is listed FIRST.
 */

describe("classifyMateriality — failing-first: a non-tracked-field-only diff must NOT trigger", () => {
  it("watchers-only diff classifies material=false", () => {
    const result = classifyMateriality([{ field: "watchers", before: "[a]", after: "[a,b]" }]);
    expect(result.material).toBe(false);
    expect(result.materialFields).toEqual([]);
  });

  it("labels + assignee diffs (multiple non-tracked fields) still classify material=false", () => {
    const result = classifyMateriality([
      { field: "labels", before: "x", after: "y" },
      { field: "assignee", before: "alice", after: "bob" },
    ]);
    expect(result.material).toBe(false);
  });
});

describe("classifyMateriality — tracked-field-triggers case", () => {
  it.each(["summary", "description", "acceptance-criteria"] as const)(
    "a %s diff classifies material=true",
    (field) => {
      const result = classifyMateriality([{ field, before: "old", after: "new" }]);
      expect(result.material).toBe(true);
      expect(result.materialFields).toEqual([field]);
    },
  );

  it("a mix of tracked + non-tracked diffs is material, and materialFields names only the tracked ones", () => {
    const result = classifyMateriality([
      { field: "watchers", before: "[a]", after: "[a,b]" },
      { field: "description", before: "old desc", after: "new desc" },
    ]);
    expect(result.material).toBe(true);
    expect(result.materialFields).toEqual(["description"]);
  });

  it("a tracked field present but UNCHANGED (before === after) is never material", () => {
    const result = classifyMateriality([{ field: "summary", before: "same", after: "same" }]);
    expect(result.material).toBe(false);
  });

  it("an empty diff set is never material", () => {
    expect(classifyMateriality([]).material).toBe(false);
  });
});

describe("buildMaterialAmendmentSignal — the trigger signal fed to 11's stop condition", () => {
  it("carries the requirementId and mirrors classifyMateriality", () => {
    const requirementId = randomUUID();
    const signal = buildMaterialAmendmentSignal(requirementId, [
      { field: "description", before: "a", after: "b" },
    ]);
    expect(signal).toEqual({
      requirementId,
      material: true,
      materialFields: ["description"],
    });
  });
});

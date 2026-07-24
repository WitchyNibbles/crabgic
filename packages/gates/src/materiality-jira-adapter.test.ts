import { describe, expect, it } from "vitest";
import type { JiraFieldMetadata } from "@eo/connectors-jira";
import { classifyMateriality } from "./materiality-classifier.js";
import { buildJiraFieldDiffs, normalizeJiraFieldId } from "./materiality-jira-adapter.js";

/**
 * MAJOR-1 fix (adversarial-validation round): feeds the materiality
 * classifier from 18's ACTUAL field-identifier shape (built-in `summary`/
 * `description` keys plus arbitrary `customfield_NNNNN` ids), not a
 * synthetic literal `"acceptance-criteria"` string. Closes the false-
 * NEGATIVE direction: a real acceptance-criteria edit arriving under its
 * Jira custom-field id must NOT be silently classified non-material.
 */

const FIELD_METADATA: readonly JiraFieldMetadata[] = [
  { id: "customfield_10057", name: "Acceptance Criteria", custom: true, schemaType: "string" },
  { id: "customfield_10099", name: "Story Points", custom: true, schemaType: "number" },
];

describe("normalizeJiraFieldId — failing-first: a customfield id for a discovered tracked-semantic field must map to its tracked name, not stay opaque", () => {
  it("maps customfield_10057 (discovered name 'Acceptance Criteria') to the tracked 'acceptance-criteria' label", () => {
    expect(normalizeJiraFieldId("customfield_10057", FIELD_METADATA)).toBe("acceptance-criteria");
  });

  it("built-in 'summary'/'description' map to themselves (already tracked labels)", () => {
    expect(normalizeJiraFieldId("summary", FIELD_METADATA)).toBe("summary");
    expect(normalizeJiraFieldId("description", FIELD_METADATA)).toBe("description");
  });

  it("an UNTRACKED custom field (Story Points) stays as its own raw id — never coerced to a tracked label", () => {
    expect(normalizeJiraFieldId("customfield_10099", FIELD_METADATA)).toBe("customfield_10099");
  });

  it("an UNDISCOVERED custom field id (absent from field metadata) stays as its own raw id, not silently dropped", () => {
    expect(normalizeJiraFieldId("customfield_99999", FIELD_METADATA)).toBe("customfield_99999");
  });

  it("a non-tracked built-in field (e.g. 'watchers') stays as itself", () => {
    expect(normalizeJiraFieldId("watchers", FIELD_METADATA)).toBe("watchers");
  });
});

describe("buildJiraFieldDiffs + classifyMateriality — the real false-negative closed: a customfield_ acceptance-criteria edit IS material", () => {
  it("an edit to customfield_10057 (Acceptance Criteria) classifies material=true via the normalized field diff", () => {
    const diffs = buildJiraFieldDiffs(
      { customfield_10057: "old AC text" },
      { customfield_10057: "new AC text" },
      FIELD_METADATA,
    );
    const result = classifyMateriality(diffs);
    expect(result.material).toBe(true);
    expect(result.materialFields).toEqual(["acceptance-criteria"]);
  });

  it("BEFORE normalization, feeding the classifier the raw customfield id directly would (correctly) NOT match — proving normalization is what closes the gap", () => {
    const rawDiffs = [{ field: "customfield_10057", before: "old AC text", after: "new AC text" }];
    expect(classifyMateriality(rawDiffs).material).toBe(false);
  });

  it("an edit to an untracked custom field (Story Points) is correctly non-material", () => {
    const diffs = buildJiraFieldDiffs(
      { customfield_10099: "3" },
      { customfield_10099: "5" },
      FIELD_METADATA,
    );
    expect(classifyMateriality(diffs).material).toBe(false);
  });

  it("a built-in summary edit alongside an untracked custom-field edit is material (only via summary)", () => {
    const diffs = buildJiraFieldDiffs(
      { summary: "old", customfield_10099: "3" },
      { summary: "new", customfield_10099: "5" },
      FIELD_METADATA,
    );
    const result = classifyMateriality(diffs);
    expect(result.material).toBe(true);
    expect(result.materialFields).toEqual(["summary"]);
  });

  it("an unchanged field (before === after) never contributes a diff entry, tracked or not", () => {
    const diffs = buildJiraFieldDiffs(
      { summary: "same", customfield_10057: "same AC" },
      { summary: "same", customfield_10057: "same AC" },
      FIELD_METADATA,
    );
    // buildJiraFieldDiffs itself may still emit a same-value diff entry
    // (classifyMateriality is responsible for the before!==after filter) —
    // either way, the end-to-end result must be non-material.
    expect(classifyMateriality(diffs).material).toBe(false);
  });
});

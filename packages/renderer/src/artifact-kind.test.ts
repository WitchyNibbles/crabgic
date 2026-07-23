import { describe, expect, it } from "vitest";
import { ARTIFACT_KINDS, isArtifactKind, type ArtifactKind } from "./artifact-kind.js";

describe("ArtifactKind", () => {
  it("is the exact 8-member closed union from roadmap/17 §Interfaces produced", () => {
    expect(ARTIFACT_KINDS).toEqual([
      "branch_name",
      "commit_subject",
      "commit_body",
      "pr_title",
      "pr_body",
      "review_comment",
      "jira_milestone_comment",
      "grafana_annotation",
    ]);
    expect(ARTIFACT_KINDS.length).toBe(8);
  });

  it("isArtifactKind accepts every member", () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(isArtifactKind(kind)).toBe(true);
    }
  });

  it("isArtifactKind rejects unknown strings and non-strings", () => {
    expect(isArtifactKind("release_notes")).toBe(false);
    expect(isArtifactKind("")).toBe(false);
    expect(isArtifactKind(42)).toBe(false);
    expect(isArtifactKind(undefined)).toBe(false);
    expect(isArtifactKind(null)).toBe(false);
  });

  it("type-level: ArtifactKind is assignable from every literal member", () => {
    const sample: ArtifactKind = "pr_title";
    expect(ARTIFACT_KINDS).toContain(sample);
  });
});

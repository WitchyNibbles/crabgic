import { describe, expect, it } from "vitest";
import { RenderedArtifactSchema } from "./rendered-artifact.js";

const validArtifact = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  kind: "pr_title",
  content: "fix(gateway): reject ambiguous writes before they reach the mutation pipeline",
  renderedAt: "2026-07-15T12:00:00.000Z",
};

describe("RenderedArtifactSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/17 Interfaces produced: RenderedArtifact instances)", () => {
    expect(RenderedArtifactSchema.safeParse(validArtifact).success).toBe(true);
  });

  it("accepts every ArtifactKind token 17 names, since `kind` is deliberately unconstrained here (owned by 17, out of scope)", () => {
    const kinds = [
      "branch_name",
      "commit_subject",
      "commit_body",
      "pr_title",
      "pr_body",
      "review_comment",
      "jira_milestone_comment",
      "grafana_annotation",
    ];
    for (const kind of kinds) {
      expect(RenderedArtifactSchema.safeParse({ ...validArtifact, kind }).success).toBe(true);
    }
  });
});

describe("RenderedArtifactSchema — invalid-shape rejection", () => {
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validArtifact;
    expect(RenderedArtifactSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty kind", () => {
    expect(RenderedArtifactSchema.safeParse({ ...validArtifact, kind: "" }).success).toBe(false);
  });

  it("rejects an empty content", () => {
    expect(RenderedArtifactSchema.safeParse({ ...validArtifact, content: "" }).success).toBe(false);
  });

  it("rejects a malformed renderedAt timestamp", () => {
    expect(
      RenderedArtifactSchema.safeParse({ ...validArtifact, renderedAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    expect(RenderedArtifactSchema.safeParse({ ...validArtifact, id: "not-a-uuid" }).success).toBe(
      false,
    );
  });
});

describe("RenderedArtifactSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    expect(
      RenderedArtifactSchema.safeParse({ ...validArtifact, unexpected: "field" }).success,
    ).toBe(false);
  });
});

describe("RenderedArtifactSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = RenderedArtifactSchema.parse(validArtifact);
    const roundTripped = RenderedArtifactSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});

import { describe, expect, it } from "vitest";
import { STACK_EVIDENCE_CATEGORIES, StackEvidenceSchema } from "./stack-evidence.js";

const validFinding = {
  category: "manifest",
  ecosystem: "node",
  detail: "package.json + package-lock.json present at repo root",
  path: "package.json",
  confidence: 0.95,
};

const validContradiction = {
  description: "conflicting `engines.node` across a monorepo's packages",
  conflictingPaths: ["packages/a/package.json", "packages/b/package.json"],
};

const validEvidence = {
  schemaVersion: 1,
  id: "8f14e45f-ceea-467e-b4d3-8b5f8f5f8f5f",
  createdAt: "2026-07-15T12:00:00.000Z",
  findings: [validFinding],
  contradictions: [validContradiction],
  unresolvedAmbiguity: [
    "cannot determine intended package manager: both npm and pnpm lockfiles present",
  ],
};

describe("StackEvidenceSchema — valid fixture", () => {
  it("parses a fully-valid fixture (roadmap/12 §In scope Detection bullet)", () => {
    expect(StackEvidenceSchema.safeParse(validEvidence).success).toBe(true);
  });

  it("accepts empty contradictions/unresolvedAmbiguity arrays (a clean detection run)", () => {
    const clean = { ...validEvidence, contradictions: [], unresolvedAmbiguity: [] };
    expect(StackEvidenceSchema.safeParse(clean).success).toBe(true);
  });

  it("accepts every declared detection category (roadmap/12 §In scope: 10-category list)", () => {
    for (const category of STACK_EVIDENCE_CATEGORIES) {
      const fixture = { ...validEvidence, findings: [{ ...validFinding, category }] };
      expect(StackEvidenceSchema.safeParse(fixture).success).toBe(true);
    }
  });
});

describe("StackEvidenceSchema — invalid-shape rejection", () => {
  it("rejects a finding with confidence outside [0, 1]", () => {
    const invalid = { ...validEvidence, findings: [{ ...validFinding, confidence: 1.5 }] };
    expect(StackEvidenceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a finding with a category outside the closed union", () => {
    const invalid = { ...validEvidence, findings: [{ ...validFinding, category: "vibes" }] };
    expect(StackEvidenceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a contradiction with fewer than 2 conflicting paths", () => {
    const invalid = {
      ...validEvidence,
      contradictions: [{ description: "only one path", conflictingPaths: ["a"] }],
    };
    expect(StackEvidenceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing createdAt", () => {
    const { createdAt: _createdAt, ...rest } = validEvidence;
    expect(StackEvidenceSchema.safeParse(rest).success).toBe(false);
  });
});

describe("StackEvidenceSchema — unknown-key rejection (.strict())", () => {
  it("rejects an unknown top-level key", () => {
    const invalid = { ...validEvidence, unexpected: "field" };
    expect(StackEvidenceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on a nested finding", () => {
    const invalid = { ...validEvidence, findings: [{ ...validFinding, unexpected: "field" }] };
    expect(StackEvidenceSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown key on a nested contradiction", () => {
    const invalid = {
      ...validEvidence,
      contradictions: [{ ...validContradiction, unexpected: "field" }],
    };
    expect(StackEvidenceSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("StackEvidenceSchema — round-trip", () => {
  it("parse -> JSON.stringify -> JSON.parse -> parse yields a deep-equal output", () => {
    const first = StackEvidenceSchema.parse(validEvidence);
    const roundTripped = StackEvidenceSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(roundTripped).toStrictEqual(first);
  });
});

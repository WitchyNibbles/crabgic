import { describe, expect, it } from "vitest";
import {
  computeCaseHash,
  decodeCasesJsonl,
  encodeCasesJsonl,
  EvalCaseSchema,
} from "./case-schema.js";

const baseCase = EvalCaseSchema.parse({
  id: "case-1",
  input: { command: "npm test", exitCode: 0 },
  expectedJudgment: true,
  provenanceId: "prov-1",
});

describe("computeCaseHash", () => {
  it("is stable across key order in input", () => {
    const reordered = { ...baseCase, input: { exitCode: 0, command: "npm test" } };
    expect(computeCaseHash(reordered)).toBe(computeCaseHash(baseCase));
  });

  it("differs when input content differs", () => {
    const different = { ...baseCase, input: { command: "npm build", exitCode: 0 } };
    expect(computeCaseHash(different)).not.toBe(computeCaseHash(baseCase));
  });

  it("differs when expectedJudgment differs", () => {
    const different = { ...baseCase, expectedJudgment: false };
    expect(computeCaseHash(different)).not.toBe(computeCaseHash(baseCase));
  });

  it("MINOR fix (adversarial-validation, 2026-07-24): nested content that differs at a NON-top-level key must hash DIFFERENTLY — a top-level-only sorted-key replacer previously dropped every nested key not also present at the top level, silently collapsing structurally-different nested input to the same hash", () => {
    const nestedLogin = EvalCaseSchema.parse({
      id: "nested-1",
      input: { scenario: { step: "login" } },
      expectedJudgment: true,
      provenanceId: "prov-nested-1",
    });
    const nestedLogout = EvalCaseSchema.parse({
      id: "nested-2",
      input: { scenario: { step: "logout" } },
      expectedJudgment: true,
      provenanceId: "prov-nested-2",
    });
    expect(computeCaseHash(nestedLogin)).not.toBe(computeCaseHash(nestedLogout));
  });

  it("is stable across key order at EVERY nesting depth, not just the top level", () => {
    const a = EvalCaseSchema.parse({
      id: "deep-a",
      input: { outer: { z: 1, a: 2 }, other: "x" },
      expectedJudgment: true,
      provenanceId: "prov-deep",
    });
    const b = EvalCaseSchema.parse({
      id: "deep-b",
      input: { other: "x", outer: { a: 2, z: 1 } },
      expectedJudgment: true,
      provenanceId: "prov-deep-2",
    });
    expect(computeCaseHash(a)).toBe(computeCaseHash(b));
  });

  it("distinguishes nested content even 3 levels deep", () => {
    const a = EvalCaseSchema.parse({
      id: "triple-a",
      input: { level1: { level2: { level3: "value-a" } } },
      expectedJudgment: true,
      provenanceId: "prov-triple-a",
    });
    const b = EvalCaseSchema.parse({
      id: "triple-b",
      input: { level1: { level2: { level3: "value-b" } } },
      expectedJudgment: true,
      provenanceId: "prov-triple-b",
    });
    expect(computeCaseHash(a)).not.toBe(computeCaseHash(b));
  });
});

describe("JSONL round-trip", () => {
  it("encodes and decodes a case list byte-for-byte equivalent", () => {
    const cases = [baseCase, { ...baseCase, id: "case-2", provenanceId: "prov-2" }];
    const encoded = encodeCasesJsonl(cases);
    expect(encoded.endsWith("\n")).toBe(true);
    expect(decodeCasesJsonl(encoded)).toEqual(cases);
  });

  it("decode skips blank lines", () => {
    const encoded = `${JSON.stringify(baseCase)}\n\n`;
    expect(decodeCasesJsonl(encoded)).toEqual([baseCase]);
  });

  it("decode of an empty string yields an empty array", () => {
    expect(decodeCasesJsonl("")).toEqual([]);
  });
});

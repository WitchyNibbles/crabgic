import { describe, expect, it } from "vitest";
import { buildStackEvidence } from "@eo/testkit";
import { stackEvidenceRiskCategories } from "./stack-evidence-risk.js";

describe("stackEvidenceRiskCategories", () => {
  it("a high-confidence migration finding contributes database + dataset_size", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "migration",
          ecosystem: "node",
          detail: "found migrations/ directory with 40 SQL files",
          path: "migrations/",
          confidence: 0.95,
        },
      ],
    });
    const categories = stackEvidenceRiskCategories(evidence);
    expect(categories.has("database")).toBe(true);
    expect(categories.has("dataset_size")).toBe(true);
  });

  it("a high-confidence infrastructure finding contributes networking + io", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "infrastructure",
          ecosystem: "terraform",
          detail: "found main.tf declaring a load balancer",
          path: "infra/main.tf",
          confidence: 0.8,
        },
      ],
    });
    const categories = stackEvidenceRiskCategories(evidence);
    expect(categories.has("networking")).toBe(true);
    expect(categories.has("io")).toBe(true);
  });

  it("a low-confidence finding below the floor contributes nothing", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "migration",
          ecosystem: "node",
          detail: "ambiguous, low-confidence guess",
          path: "maybe-migrations/",
          confidence: 0.2,
        },
      ],
    });
    expect(stackEvidenceRiskCategories(evidence).size).toBe(0);
  });

  it("a category with no risk mapping (e.g. manifest) contributes nothing", () => {
    const evidence = buildStackEvidence({
      findings: [
        {
          category: "manifest",
          ecosystem: "node",
          detail: "package.json present",
          path: "package.json",
          confidence: 0.99,
        },
      ],
    });
    expect(stackEvidenceRiskCategories(evidence).size).toBe(0);
  });

  it("no findings at all produces an empty set", () => {
    const evidence = buildStackEvidence({ findings: [] });
    expect(stackEvidenceRiskCategories(evidence).size).toBe(0);
  });
});

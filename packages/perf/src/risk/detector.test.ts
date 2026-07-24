import { describe, expect, it } from "vitest";
import { buildStackEvidence } from "@eo/testkit";
import { detectPerformanceRisk } from "./detector.js";

describe("detectPerformanceRisk", () => {
  it("detects categories from diff paths alone when no StackEvidence is available", () => {
    const categories = detectPerformanceRisk({
      diffPaths: ["src/cache/lru.ts", "src/http/client.ts"],
    });
    expect(categories).toEqual(["caching", "networking"]);
  });

  it("unions diff-path categories with StackEvidence-derived categories", () => {
    const stackEvidence = buildStackEvidence({
      findings: [
        {
          category: "migration",
          ecosystem: "node",
          detail: "migrations/ directory found",
          path: "migrations/",
          confidence: 0.9,
        },
      ],
    });
    const categories = detectPerformanceRisk({
      diffPaths: ["src/cache/lru.ts"],
      stackEvidence,
    });
    expect(categories).toEqual(["caching", "database", "dataset_size"]);
  });

  it("an empty diff with no StackEvidence produces an empty, sorted, deterministic result", () => {
    expect(detectPerformanceRisk({ diffPaths: [] })).toEqual([]);
  });

  it("is a pure function of its inputs: identical inputs produce byte-identical output", () => {
    const options = { diffPaths: ["src/db/repository.ts", "src/cache/lru.ts"] };
    expect(detectPerformanceRisk(options)).toEqual(detectPerformanceRisk({ ...options }));
  });
});

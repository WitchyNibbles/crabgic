import { describe, expect, it } from "vitest";
import { EvalCaseSchema } from "../eval/case-schema.js";
import { exportToPromptfooConfig } from "./export.js";

describe("exportToPromptfooConfig", () => {
  it("maps each EvalCase to one Promptfoo test with an equals assertion on expectedJudgment", () => {
    const cases = [
      EvalCaseSchema.parse({
        id: "case-1",
        input: { command: "npm test" },
        expectedJudgment: true,
        provenanceId: "prov-1",
      }),
    ];
    const config = exportToPromptfooConfig("dev set", cases);
    expect(config.description).toBe("dev set");
    expect(config.tests).toHaveLength(1);
    expect(config.tests[0]).toEqual({
      description: "case-1",
      vars: { input: { command: "npm test" } },
      assert: [{ type: "equals", value: true }],
    });
  });

  it("an empty case list yields an empty (but well-formed) test list", () => {
    const config = exportToPromptfooConfig("empty", []);
    expect(config.tests).toEqual([]);
    expect(config.prompts.length).toBeGreaterThan(0);
  });
});

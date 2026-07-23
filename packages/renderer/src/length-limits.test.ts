import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { lengthLimitsStage, STAGE_NAME_LENGTH_LIMITS } from "./length-limits.js";
import type { ArtifactKind } from "./artifact-kind.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string, kind: ArtifactKind): LintStageInput {
  return { candidate, kind, policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("lengthLimitsStage", () => {
  it("allows a commit subject at exactly the 72-char boundary", () => {
    const subject = `feat(x): ${"a".repeat(72 - "feat(x): ".length)}`;
    expect(subject.length).toBe(72);
    expect(lengthLimitsStage(stageInput(subject, "commit_subject"))).toEqual([]);
  });

  it("blocks a commit subject one char over the 72-char boundary", () => {
    const subject = `feat(x): ${"a".repeat(72 - "feat(x): ".length + 1)}`;
    expect(subject.length).toBe(73);
    const findings = lengthLimitsStage(stageInput(subject, "commit_subject"));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.stage).toBe(STAGE_NAME_LENGTH_LIMITS);
    expect(findings[0]!.message).toMatch(/73 chars exceeds the 72-char limit/);
  });

  it("allows a review comment at exactly the 6-line boundary", () => {
    const text = ["a", "b", "c", "d", "e", "f"].join("\n");
    expect(lengthLimitsStage(stageInput(text, "review_comment"))).toEqual([]);
  });

  it("blocks a review comment one line over the 6-line boundary", () => {
    const text = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const findings = lengthLimitsStage(stageInput(text, "review_comment"));
    expect(findings.some((f) => f.message.match(/7 lines exceeds the 6-line limit/))).toBe(true);
  });

  it("blocks trailing whitespace on a line", () => {
    const findings = lengthLimitsStage(stageInput("clean line\ndirty line   \n", "commit_body"));
    expect(findings.some((f) => f.message.match(/trailing whitespace/))).toBe(true);
  });

  it("allows text with no trailing whitespace", () => {
    expect(lengthLimitsStage(stageInput("line one\nline two", "commit_body"))).toEqual([]);
  });

  it("reads limits from the policy argument, not a hardcoded constant", () => {
    const customPolicy = {
      ...DEFAULT_COMMUNICATION_POLICY,
      limits: { ...DEFAULT_COMMUNICATION_POLICY.limits, branchName: { maxChars: 5 } },
    };
    const findings = lengthLimitsStage({ candidate: "123456", kind: "branch_name", policy: customPolicy });
    expect(findings.some((f) => f.message.match(/6 chars exceeds the 5-char limit/))).toBe(true);
  });
});

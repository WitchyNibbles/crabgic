import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { mentionPolicyStage, STAGE_NAME_MENTION_POLICY } from "./mention-policy.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string): LintStageInput {
  return { candidate, kind: "pr_body", policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("mentionPolicyStage", () => {
  it("blocks an @-mention token", () => {
    const findings = mentionPolicyStage(stageInput("cc @octocat please review"));
    expect(findings.length).toBe(1);
    expect(findings[0]!.stage).toBe(STAGE_NAME_MENTION_POLICY);
  });

  it("blocks @here/@channel/@all notification triggers", () => {
    for (const token of ["@here", "@channel", "@all"]) {
      expect(mentionPolicyStage(stageInput(`ping ${token}`)).length).toBe(1);
    }
  });

  it("does not flag an ordinary email address", () => {
    expect(mentionPolicyStage(stageInput("contact user@example.com for details"))).toEqual([]);
  });

  it("allows text with no @ tokens", () => {
    expect(
      mentionPolicyStage(
        stageInput("Outcome: done\nValidation: green\nRisk: none\nTracking: none"),
      ),
    ).toEqual([]);
  });
});

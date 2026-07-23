import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { schemaValidationStage, STAGE_NAME_SCHEMA_VALIDATION } from "./schema-validation.js";
import type { ArtifactKind } from "./artifact-kind.js";
import type { LintStageInput } from "./lint-types.js";

function stageInput(candidate: string, kind: ArtifactKind): LintStageInput {
  return { candidate, kind, policy: DEFAULT_COMMUNICATION_POLICY };
}

describe("schemaValidationStage — commit_subject / pr_title format", () => {
  it("allows a well-formed conventional commit subject", () => {
    expect(schemaValidationStage(stageInput("feat(renderer): add lint pipeline", "commit_subject"))).toEqual([]);
  });

  it("allows a scopeless conventional subject", () => {
    expect(schemaValidationStage(stageInput("feat: add lint pipeline", "commit_subject"))).toEqual([]);
  });

  it("blocks a subject with no colon separator", () => {
    const findings = schemaValidationStage(stageInput("added the lint pipeline", "commit_subject"));
    expect(findings.length).toBe(1);
    expect(findings[0]!.stage).toBe(STAGE_NAME_SCHEMA_VALIDATION);
  });

  it("blocks a multi-line pr_title", () => {
    const findings = schemaValidationStage(stageInput("feat: a\nsecond line", "pr_title"));
    expect(findings.some((f) => f.message.match(/single line/))).toBe(true);
  });
});

describe("schemaValidationStage — pr_body sections", () => {
  const valid = "Outcome: done\nValidation: green\nRisk: none\nTracking: none";

  it("allows a fully-shaped pr_body", () => {
    expect(schemaValidationStage(stageInput(valid, "pr_body"))).toEqual([]);
  });

  it("blocks an unknown section label", () => {
    const findings = schemaValidationStage(
      stageInput("Outcome: done\nValidation: green\nRisk: none\nExtra: field", "pr_body"),
    );
    expect(findings.some((f) => f.message.match(/unknown section field "Extra"/))).toBe(true);
  });

  it("blocks a missing required section", () => {
    const findings = schemaValidationStage(stageInput("Outcome: done\nValidation: green\nRisk: none", "pr_body"));
    expect(findings.some((f) => f.message.match(/required section "Tracking" is missing/))).toBe(true);
  });
});

describe("schemaValidationStage — jira_milestone_comment sections", () => {
  it("allows a fully-shaped milestone comment", () => {
    const text = "Outcome: done\nEvidence: link\nRisk: none\nNext: ship\nRef: PROJ-1";
    expect(schemaValidationStage(stageInput(text, "jira_milestone_comment"))).toEqual([]);
  });

  it("blocks an unknown field", () => {
    const findings = schemaValidationStage(
      stageInput("Outcome: done\nEvidence: link\nRisk: none\nNext: ship\nRef: PROJ-1\nBonus: x", "jira_milestone_comment"),
    );
    expect(findings.some((f) => f.message.match(/unknown section field "Bonus"/))).toBe(true);
  });
});

describe("schemaValidationStage — review_comment shape", () => {
  it("allows a fully-shaped review comment", () => {
    const text = "Finding: null deref\nEvidence: test.ts:42\nAction: add guard";
    expect(schemaValidationStage(stageInput(text, "review_comment"))).toEqual([]);
  });

  it("blocks a missing shape component", () => {
    const findings = schemaValidationStage(stageInput("Finding: x\nEvidence: y", "review_comment"));
    expect(findings.some((f) => f.message.match(/required section "Action" is missing/))).toBe(true);
  });
});

describe("schemaValidationStage — structural no-op kinds", () => {
  it("is a no-op for branch_name, commit_body, grafana_annotation", () => {
    expect(schemaValidationStage(stageInput("feature/anything", "branch_name"))).toEqual([]);
    expect(schemaValidationStage(stageInput("free-form body text", "commit_body"))).toEqual([]);
    expect(schemaValidationStage(stageInput("state | service | change | evidence=x", "grafana_annotation"))).toEqual(
      [],
    );
  });
});

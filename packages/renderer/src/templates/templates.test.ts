import { describe, expect, it } from "vitest";
import { DEFAULT_COMMUNICATION_POLICY } from "@eo/contracts";
import { lint } from "../lint.js";
import { renderJiraMilestoneComment } from "./jira-milestone-comment.js";
import { renderGrafanaAnnotation } from "./grafana-annotation.js";
import { renderPrTitle } from "./pr-title.js";
import { renderPrBody } from "./pr-body.js";
import { renderReviewComment } from "./review-comment.js";

describe("renderJiraMilestoneComment", () => {
  it("assembles the Outcome/Evidence/Risk/Next/Ref shape and passes lint", () => {
    const text = renderJiraMilestoneComment({
      outcome: "shipped",
      evidence: "https://ci.example.com/1",
      risk: "none",
      next: "monitor",
      ref: "PROJ-1",
    });
    expect(text).toBe(
      "Outcome: shipped\nEvidence: https://ci.example.com/1\nRisk: none\nNext: monitor\nRef: PROJ-1",
    );
    expect(lint(text, "jira_milestone_comment", DEFAULT_COMMUNICATION_POLICY)).toEqual({
      ok: true,
    });
  });

  it("over-length fixture is blocked by lint (work item 6 failing-first)", () => {
    const text = renderJiraMilestoneComment({
      outcome: "a".repeat(900),
      evidence: "https://ci.example.com/1",
      risk: "none",
      next: "monitor",
      ref: "PROJ-1",
    });
    const outcome = lint(text, "jira_milestone_comment", DEFAULT_COMMUNICATION_POLICY);
    expect(outcome.ok).toBe(false);
  });
});

describe("renderGrafanaAnnotation", () => {
  it("assembles the pipe-delimited shape and passes lint", () => {
    const text = renderGrafanaAnnotation({
      state: "resolved",
      service: "api-gateway",
      change: "rolled back v2.3",
      evidenceRef: "https://ci.example.com/2",
    });
    expect(text).toBe(
      "resolved | api-gateway | rolled back v2.3 | evidence=https://ci.example.com/2",
    );
    expect(lint(text, "grafana_annotation", DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
  });

  it("over-length fixture is blocked by lint", () => {
    const text = renderGrafanaAnnotation({
      state: "resolved",
      service: "a".repeat(300),
      change: "x",
      evidenceRef: "https://ci.example.com/2",
    });
    expect(lint(text, "grafana_annotation", DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);
  });
});

describe("renderPrTitle", () => {
  it("enforces ≤72 chars and 'type(scope): outcome', golden-proven against the commit-subject convention", () => {
    const text = renderPrTitle({
      type: "feat",
      scope: "renderer",
      outcome: "add blocking lint pipeline",
    });
    expect(text).toBe("feat(renderer): add blocking lint pipeline");
    expect(lint(text, "pr_title", DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
    expect(lint(text, "commit_subject", DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
  });

  it("renders without a scope", () => {
    expect(renderPrTitle({ type: "fix", outcome: "correct the parser" })).toBe(
      "fix: correct the parser",
    );
  });

  it("over-length fixture is blocked by lint", () => {
    const text = renderPrTitle({ type: "feat", scope: "x", outcome: "a".repeat(100) });
    expect(lint(text, "pr_title", DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);
  });
});

describe("renderPrBody", () => {
  it("assembles the Outcome/Validation/Risk/Tracking shape and passes lint", () => {
    const text = renderPrBody({
      outcome: "shipped feature X",
      validation: "unit + integration tests green",
      risk: "low, feature-flagged",
      tracking: "PROJ-1",
    });
    expect(lint(text, "pr_body", DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
  });

  it("over-length fixture is blocked by lint", () => {
    const text = renderPrBody({
      outcome: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"),
      validation: "green",
      risk: "none",
      tracking: "none",
    });
    expect(lint(text, "pr_body", DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);
  });
});

describe("renderReviewComment", () => {
  it("assembles the finding/evidence/action shape and passes lint", () => {
    const text = renderReviewComment({
      finding: "missing null check",
      evidence: "src/parser.ts:42, https://ci.example.com/3",
      action: "add guard clause",
    });
    expect(lint(text, "review_comment", DEFAULT_COMMUNICATION_POLICY)).toEqual({ ok: true });
  });

  it("over-length fixture is blocked by lint", () => {
    const text = renderReviewComment({
      finding: Array.from({ length: 8 }, (_, i) => `line ${i}`).join("\n"),
      evidence: "x",
      action: "y",
    });
    expect(lint(text, "review_comment", DEFAULT_COMMUNICATION_POLICY).ok).toBe(false);
  });
});

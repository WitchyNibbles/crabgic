import { describe, expect, it } from "vitest";
import { renderJiraMilestoneComment } from "./templates/jira-milestone-comment.js";
import { renderGrafanaAnnotation } from "./templates/grafana-annotation.js";
import { renderPrTitle } from "./templates/pr-title.js";
import { renderPrBody } from "./templates/pr-body.js";
import { renderReviewComment } from "./templates/review-comment.js";
import { toADF } from "./adf.js";
import { toWikiMarkup } from "./wiki-markup.js";

/**
 * Golden byte-stability suite — roadmap/17 §Test plan: "byte-stable
 * snapshot per `ArtifactKind` × valid-input pair, diffed across two
 * consecutive builds (mirrors 02's own JSON-Schema byte-stability
 * convention)." Every template/converter here is a PURE function of its
 * input, so re-running this suite on an unchanged source tree always
 * reproduces byte-identical output — vitest's own snapshot mechanism is the
 * diffing tool; a snapshot drift on an unchanged input is this exit
 * criterion failing.
 */

describe("golden byte-stability — one valid fixture per ArtifactKind", () => {
  it("branch_name (plain string, no template)", () => {
    expect("feature/renderer-lint-pipeline").toMatchSnapshot();
  });

  it("commit_subject", () => {
    expect(
      renderPrTitle({ type: "feat", scope: "renderer", outcome: "add blocking lint pipeline" }),
    ).toMatchSnapshot();
  });

  it("commit_body (plain string, no template)", () => {
    expect(
      "Adds the ordered lint stage pipeline and regenerate-once orchestration.",
    ).toMatchSnapshot();
  });

  it("pr_title", () => {
    expect(
      renderPrTitle({ type: "feat", scope: "renderer", outcome: "add blocking lint pipeline" }),
    ).toMatchSnapshot();
  });

  it("pr_body", () => {
    expect(
      renderPrBody({
        outcome: "shipped the renderer's blocking lint pipeline",
        validation: "unit + property + golden suites green",
        risk: "low, no external callers yet",
        tracking: "PROJ-17",
      }),
    ).toMatchSnapshot();
  });

  it("review_comment", () => {
    expect(
      renderReviewComment({
        finding: "missing null check on parsed input",
        evidence: "src/parser.ts:42",
        action: "add a guard clause before dereferencing",
      }),
    ).toMatchSnapshot();
  });

  it("jira_milestone_comment", () => {
    expect(
      renderJiraMilestoneComment({
        outcome: "milestone shipped",
        evidence: "https://ci.example.com/build/42",
        risk: "none",
        next: "monitor for a week",
        ref: "PROJ-17",
      }),
    ).toMatchSnapshot();
  });

  it("grafana_annotation", () => {
    expect(
      renderGrafanaAnnotation({
        state: "resolved",
        service: "renderer-service",
        change: "deployed v1.2.0",
        evidenceRef: "https://ci.example.com/build/42",
      }),
    ).toMatchSnapshot();
  });
});

describe("golden byte-stability — toADF / toWikiMarkup", () => {
  const markdown = [
    "# Milestone update",
    "",
    "Outcome: shipped the **renderer** lint pipeline.",
    "",
    "- unit suite green",
    "- property suite green",
    "",
    "See [the build](https://ci.example.com/build/42) for details.",
  ].join("\n");

  it("toADF", () => {
    expect(toADF(markdown)).toMatchSnapshot();
  });

  it("toWikiMarkup", () => {
    expect(toWikiMarkup(markdown)).toMatchSnapshot();
  });
});
